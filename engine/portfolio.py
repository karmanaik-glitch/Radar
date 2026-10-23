"""Deterministic model portfolio ledger; never connects to a broker."""
from copy import deepcopy
from datetime import datetime, timezone

DEFAULT_CONFIG = {
    'starting_capital': 1000000.0,
    'max_positions': 15,
    'max_position_pct': 0.10,
    'max_sector_pct': 0.25,
    'cost_bps_per_side': 15.0,
    'slippage_bps_per_side': 5.0,
}


def initial_state(config=None):
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    return {'schema_version': 1, 'config': cfg, 'cash': cfg['starting_capital'], 'positions': {},
            'pending_orders': [], 'trades': [], 'equity_history': [], 'processed_signal_dates': [],
            'created_at': datetime.now(timezone.utc).isoformat(), 'last_updated': None}


def _cost(notional, cfg):
    return notional * (cfg['cost_bps_per_side'] + cfg['slippage_bps_per_side']) / 10000.0


def process_open(state, date, open_prices):
    """Resolve pending orders from prior signals using today's open; idempotent by order id."""
    state = deepcopy(state)
    cfg = state['config']; remaining = []
    for order in state['pending_orders']:
        if order.get('signal_date') == date or order.get('status') == 'filled' or str(order.get('status', '')).startswith('rejected'):
            remaining.append(order); continue
        symbol = order['symbol']; px = open_prices.get(symbol)
        if not px or px <= 0:
            order['status'] = 'waiting_for_valid_open'; remaining.append(order); continue
        if order['side'] == 'BUY':
            if symbol in state['positions'] or len(state['positions']) >= cfg['max_positions']:
                order['status'] = 'rejected_risk_gate'; order['resolved_date'] = date; remaining.append(order); continue
            # Enforce the configured industry/sector concentration limit using marked values.
            total_equity = state['cash'] + sum(float(p.get('market_value', float(p.get('quantity', 0)) * float(p.get('last_price', p.get('entry_price', 0)))) or 0) for p in state['positions'].values())
            sector = order.get('industry', 'Unknown')
            sector_value = sum(float(p.get('market_value', float(p.get('quantity', 0)) * float(p.get('last_price', p.get('entry_price', 0)))) or 0) for p in state['positions'].values() if p.get('industry', 'Unknown') == sector)
            max_sector_value = total_equity * float(cfg.get('max_sector_pct', 1.0))
            budget = min(state['cash'], cfg['starting_capital'] * cfg['max_position_pct'], max(0.0, max_sector_value-sector_value))
            cost_per_share = px * (1 + (cfg['cost_bps_per_side'] + cfg['slippage_bps_per_side']) / 10000)
            qty = int(budget // cost_per_share)
            if qty <= 0:
                order['status'] = 'rejected_insufficient_cash'; order['resolved_date'] = date; remaining.append(order); continue
            notional = qty * px; fee = _cost(notional, cfg)
            if notional + fee > state['cash']:
                qty = int(state['cash'] / (px * (1 + (cfg['cost_bps_per_side'] + cfg['slippage_bps_per_side']) / 10000)))
                notional = qty * px; fee = _cost(notional, cfg)
            if qty <= 0:
                order['status'] = 'rejected_insufficient_cash'; order['resolved_date'] = date; remaining.append(order); continue
            state['cash'] -= notional + fee
            state['positions'][symbol] = {'symbol': symbol, 'quantity': qty, 'entry_price': px,
                'entry_date': date, 'entry_fee': fee, 'entry_signal_date': order['signal_date'],
                'industry': order.get('industry', 'Unknown'), 'last_price': px}
            order.update({'status': 'filled', 'fill_date': date, 'fill_price': px, 'quantity': qty, 'fees': fee})
        else:
            pos = state['positions'].get(symbol)
            if not pos:
                order['status'] = 'rejected_no_position'; order['resolved_date'] = date; remaining.append(order); continue
            qty = pos['quantity']; notional = qty * px; fee = _cost(notional, cfg)
            state['cash'] += notional - fee
            gross = (px - pos['entry_price']) * qty
            total_costs = fee + pos.get('entry_fee', 0)
            state['trades'].append({'symbol': symbol, 'quantity': qty, 'entry_date': pos['entry_date'],
                'entry_price': pos['entry_price'], 'exit_date': date, 'exit_price': px,
                'gross_pnl': round(gross, 2), 'costs': round(total_costs, 2),
                'net_pnl': round(gross - total_costs, 2),
                'return_pct_net': round((gross-total_costs)/(pos['entry_price']*qty)*100, 3),
                'holding_sessions': None, 'entry_signal_date': pos.get('entry_signal_date'),
                'exit_signal_date': order['signal_date'], 'industry': pos.get('industry', 'Unknown')})
            del state['positions'][symbol]
            order.update({'status': 'filled', 'fill_date': date, 'fill_price': px, 'quantity': qty, 'fees': fee})
        remaining.append(order)
    state['pending_orders'] = remaining
    return state


def queue_signals(state, date, signals, prices_by_symbol):
    """Queue at most one action per symbol/date; fills occur on a later session open."""
    state = deepcopy(state)
    if date in state['processed_signal_dates']:
        return state
    pending_keys = {(o['symbol'], o['signal_date'], o['side']) for o in state['pending_orders']}
    for item in signals:
        sym, sig = item.get('symbol'), item.get('signal')
        has_pending_buy = any(o.get('symbol') == sym and o.get('side') == 'BUY' and o.get('status') not in ('filled', 'rejected_risk_gate', 'rejected_insufficient_cash') for o in state['pending_orders'])
        side = 'BUY' if sig == 'BUY' and sym not in state['positions'] and not has_pending_buy else ('SELL' if sig == 'SELL' and sym in state['positions'] else None)
        if not side or not sym or (sym, date, side) in pending_keys:
            continue
        state['pending_orders'].append({'id': f'{date}:{sym}:{side}', 'symbol': sym, 'side': side,
            'signal_date': date, 'status': 'pending_next_open', 'signal_score': item.get('score'),
            'industry': item.get('industry', 'Unknown'), 'reference_close': prices_by_symbol.get(sym)})
    state['processed_signal_dates'].append(date)
    return state


def mark_to_market(state, date, close_prices):
    state = deepcopy(state)
    invested = 0.0
    for sym, pos in state['positions'].items():
        px = close_prices.get(sym, pos.get('last_price', pos['entry_price']))
        if px and px > 0:
            pos['last_price'] = float(px)
        pos['market_value'] = pos['quantity'] * pos['last_price']
        pos['unrealised_pnl'] = (pos['last_price'] - pos['entry_price']) * pos['quantity'] - pos.get('entry_fee', 0)
        pos['weight_pct'] = None
        invested += pos['market_value']
    equity = state['cash'] + invested
    for pos in state['positions'].values():
        pos['weight_pct'] = round(pos['market_value'] / equity * 100, 2) if equity else 0
    # Idempotent same-day reruns replace that date's mark rather than duplicate history rows.
    state['equity_history'] = [x for x in state['equity_history'] if x.get('date') != date]
    prev_peak = max([x.get('equity', equity) for x in state['equity_history']] + [equity])
    state['equity_history'].append({'date': date, 'cash': round(state['cash'], 2), 'invested': round(invested, 2),
        'equity': round(equity, 2), 'drawdown_pct': round((equity/prev_peak-1)*100, 3) if prev_peak else 0})
    state['last_updated'] = datetime.now(timezone.utc).isoformat()
    return state
