"""Versioned deterministic scoring rules. Thresholds are hypotheses, not proven alpha."""
from datetime import datetime, timezone
RULESET_VERSION = 'strata-rules-0.2.0'


def _num(value):
    try:
        v = float(value)
        return v if v == v and abs(v) != float('inf') else None
    except (TypeError, ValueError):
        return None


def score_stock(technical: dict, fundamentals: dict, held: bool = False, data_ok: bool = True) -> dict:
    reasons, failed = [], []
    if not data_ok:
        return {'signal': 'DATA BLOCKED', 'score': None, 'technical_score': None,
                'fundamental_score': None, 'reasons': ['Required data missing, stale or invalid.'],
                'failed_conditions': ['Data quality gate'], 'ruleset_version': RULESET_VERSION}

    close = _num(technical.get('Close'))
    sma50 = _num(technical.get('SMA50'))
    sma200 = _num(technical.get('SMA200'))
    rsi14 = _num(technical.get('RSI14'))
    macd = _num(technical.get('MACD'))
    macd_signal = _num(technical.get('MACD_SIGNAL'))
    ret20 = _num(technical.get('RETURN_20D'))
    vol_ratio = _num(technical.get('VOLUME_RATIO20'))
    adx = _num(technical.get('ADX14'))
    bb_upper = _num(technical.get('BB_UPPER20'))
    relative_strength = _num(technical.get('RELATIVE_STRENGTH_20D'))
    if None in (close, sma50, rsi14, macd, macd_signal):
        return {'signal': 'DATA BLOCKED', 'score': None, 'technical_score': None,
                'fundamental_score': None, 'reasons': ['Not enough valid history for core indicators.'],
                'failed_conditions': ['Indicator readiness'], 'ruleset_version': RULESET_VERSION}

    t_score = 0
    if close > sma50:
        t_score += 25; reasons.append('Close above 50-day average')
    else: failed.append('Close above 50-day average')
    if sma200 is not None and close > sma200:
        t_score += 20; reasons.append('Close above 200-day average')
    elif sma200 is not None: failed.append('Close above 200-day average')
    if 45 <= rsi14 <= 68:
        t_score += 20; reasons.append('RSI in positive momentum band')
    else: failed.append('RSI in positive momentum band')
    if macd > macd_signal:
        t_score += 20; reasons.append('MACD above signal line')
    else: failed.append('MACD above signal line')
    if ret20 is not None and ret20 > 0:
        t_score += 15; reasons.append('Positive 20-session return')
    else: failed.append('Positive 20-session return')

    roe = _num(fundamentals.get('ROE_pct'))
    debt = _num(fundamentals.get('Debt_Equity'))
    growth = _num(fundamentals.get('Revenue_Growth_pct'))
    pe = _num(fundamentals.get('PE_Ratio'))
    f_score, f_reasons = 0, []
    f_fields = 0
    if roe is not None:
        f_fields += 1
        if roe >= 12: f_score += 35; f_reasons.append('ROE ≥ 12%')
    if debt is not None:
        f_fields += 1
        if debt <= 100: f_score += 25; f_reasons.append('Debt/equity ≤ 1.0 (provider scale)')
    if growth is not None:
        f_fields += 1
        if growth > 0: f_score += 25; f_reasons.append('Positive revenue growth')
    if pe is not None:
        f_fields += 1
        if 0 < pe < 45: f_score += 15; f_reasons.append('Positive trailing P/E below 45')
    # Fundamentals are useful only if enough fields exist; otherwise don't silently award a neutral score.
    if f_fields < 2:
        return {'signal': 'DATA BLOCKED', 'score': None, 'technical_score': t_score,
                'fundamental_score': None, 'reasons': reasons + ['Insufficient fundamental fields for scoring.'],
                'failed_conditions': failed + ['Fundamental coverage gate'], 'ruleset_version': RULESET_VERSION}

    f_score = min(f_score, 100)
    combined = round(t_score * 0.60 + f_score * 0.40, 1)
    # This is a daily long-only strategy: SELL is an exit condition for held positions only.
    exit_condition = (close < sma50) or (rsi14 < 38) or (macd < macd_signal and (ret20 is not None and ret20 < 0))
    if held and exit_condition:
        signal = 'SELL'; reasons.append('Held-position exit condition triggered')
    elif not held and combined >= 70 and t_score >= 60 and f_score >= 45:
        signal = 'BUY'; reasons.append('Entry score and risk gates passed')
    else:
        signal = 'HOLD'
        if not held and combined < 70: failed.append('Combined score ≥ 70')
        if held and not exit_condition: reasons.append('Position retained; no exit condition triggered')
    # Named setups are descriptive classifications, not calibrated probabilities.
    setup_type = None
    if bb_upper is not None and close > bb_upper and vol_ratio is not None and vol_ratio >= 1.5 and (adx is None or adx >= 15):
        setup_type = 'Breakout'
        reasons.append('Breakout candidate: close above upper Bollinger band with elevated volume')
    elif close > sma50 and (sma200 is None or close > sma200) and 45 <= rsi14 <= 68 and macd > macd_signal:
        setup_type = 'Trend Continuation'
    elif relative_strength is not None and relative_strength > 0 and ret20 is not None and ret20 > 0 and close > sma50:
        setup_type = 'Relative Strength Leader'
    elif rsi14 < 35 and ret20 is not None and ret20 < 0 and macd > macd_signal:
        setup_type = 'Oversold Recovery'
    risk_warnings = []
    if rsi14 > 70: risk_warnings.append('Momentum may be extended: RSI above 70.')
    if adx is not None and adx < 15: risk_warnings.append('ADX below 15 suggests a weak or choppy trend.')
    if setup_type == 'Breakout' and (vol_ratio is None or vol_ratio < 1.5): risk_warnings.append('Breakout volume confirmation is weak or unavailable.')
    if combined < 70: risk_warnings.append('Combined heuristic score is below the current entry threshold.')
    return {'signal': signal, 'score': combined, 'technical_score': t_score,
            'fundamental_score': f_score, 'setup_type': setup_type, 'risk_warnings': risk_warnings,
            'reasons': reasons + f_reasons, 'failed_conditions': failed, 'ruleset_version': RULESET_VERSION}
