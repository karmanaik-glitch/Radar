import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
from indicators import enrich_ohlcv, rsi
from rules import score_stock, RULESET_VERSION
from portfolio import initial_state, queue_signals, process_open, mark_to_market
from market_rules import classify_market_regime, sector_rotation, risk_plan
from history_store import store_history_snapshot

class IndicatorTests(unittest.TestCase):
    def test_enrichment_adds_expected_columns(self):
        idx = pd.date_range('2024-01-01', periods=260, freq='B')
        close = pd.Series([100+i*.2 for i in range(260)], index=idx)
        frame = pd.DataFrame({'Open':close-.2,'High':close+1,'Low':close-1,'Close':close,'Volume':[1000]*260}, index=idx)
        out = enrich_ohlcv(frame)
        for col in ['SMA20','SMA50','SMA200','RSI14','MACD','MACD_SIGNAL','ATR14','VOLUME_SMA20','VOLUME_RATIO20','RETURN_1D','RETURN_20D','BB_UPPER20','BB_LOWER20','ADX14']:
            self.assertIn(col, out.columns)
        self.assertAlmostEqual(out['SMA200'].iloc[-1], close.iloc[-200:].mean())

    def test_rsi_range(self):
        s = pd.Series([float(100+i) for i in range(40)])
        val = rsi(s).dropna().iloc[-1]
        self.assertGreaterEqual(val, 0)
        self.assertLessEqual(val, 100)

class RuleTests(unittest.TestCase):
    def test_missing_data_blocks_signal(self):
        result = score_stock({}, {}, data_ok=False)
        self.assertEqual(result['signal'], 'DATA BLOCKED')

    def test_signal_is_deterministic(self):
        tech={'Close':120,'SMA50':110,'SMA200':100,'RSI14':55,'MACD':3,'MACD_SIGNAL':2,'RETURN_20D':5}
        fund={'ROE_pct':15,'Debt_Equity':50,'Revenue_Growth_pct':8,'PE_Ratio':25}
        a=score_stock(tech,fund,held=False,data_ok=True)
        b=score_stock(tech,fund,held=False,data_ok=True)
        self.assertEqual(a,b)
        self.assertEqual(a['ruleset_version'], RULESET_VERSION)
        self.assertIn('setup_type', a)
        self.assertIn('risk_warnings', a)

class MarketRuleTests(unittest.TestCase):
    def test_regime_requires_enough_evidence(self):
        result = classify_market_regime(benchmark_return_20d=5, pct_above_sma50=70, pct_above_sma200=65)
        self.assertEqual(result['label'], 'INSUFFICIENT DATA')
        full = classify_market_regime(benchmark_return_20d=8, pct_above_sma50=80, pct_above_sma200=75, average_rsi=60, average_adx=25)
        self.assertEqual(full['label'], 'STRONG RISK-ON')
        self.assertIsInstance(full['score'], float)

    def test_risk_plan_caps_quantity_and_validates(self):
        plan = risk_plan(100000, 1, 100, 95, 115, max_capital_pct=20)
        self.assertTrue(plan['valid'])
        self.assertEqual(plan['quantity'], 200)
        self.assertEqual(plan['risk_budget'], 1000)
        self.assertFalse(risk_plan(100000, 1, 100, 100)['valid'])

    def test_sector_rotation_is_descriptive_and_sorted(self):
        rows = [
            {'symbol':'A','industry':'Tech','signal':'BUY','score':80,'change_pct':2,'data_quality':'OK','technical':{'Close':120,'SMA50':100}},
            {'symbol':'B','industry':'Tech','signal':'HOLD','score':70,'change_pct':1,'data_quality':'OK','technical':{'Close':110,'SMA50':100}},
            {'symbol':'C','industry':'Retail','signal':'HOLD','score':30,'change_pct':-2,'data_quality':'OK','technical':{'Close':80,'SMA50':100}},
        ]
        result = sector_rotation(rows)
        self.assertEqual(result[0]['industry'], 'Tech')
        self.assertEqual(result[0]['breadth_above_sma50_pct'], 100.0)

class PipelineHistoryTests(unittest.TestCase):
    def test_history_is_gzipped_and_retention_is_bounded(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            history = Path(temp_dir)
            old = history / '2024-01-01.json.gz'
            old.write_bytes(gzip.compress(b'{"old":true}', mtime=0))
            result = store_history_snapshot(history, '2025-01-02', {'exchange_date': '2025-01-02'}, keep=1)
            files = list(history.glob('*.json.gz'))
            self.assertEqual([f.name for f in files], ['2025-01-02.json.gz'])
            with gzip.open(result, 'rt', encoding='utf-8') as stream:
                self.assertEqual(json.load(stream)['exchange_date'], '2025-01-02')


class PortfolioTests(unittest.TestCase):
    def test_buy_fills_only_on_later_open_and_not_twice(self):
        state=initial_state({'starting_capital':100000,'max_position_pct':.2})
        state=queue_signals(state,'2025-01-02',[{'symbol':'ABC','signal':'BUY','score':80,'industry':'Industrials'}],{'ABC':100})
        self.assertEqual(len(state['positions']),0)
        state=process_open(state,'2025-01-03',{'ABC':101})
        self.assertIn('ABC',state['positions'])
        state=queue_signals(state,'2025-01-03',[{'symbol':'ABC','signal':'BUY','score':80,'industry':'Industrials'}],{'ABC':102})
        self.assertEqual(sum(o['side']=='BUY' and o['symbol']=='ABC' and o['status']!='filled' for o in state['pending_orders']),0)

    def test_sell_without_position_is_not_queued(self):
        state=initial_state()
        state=queue_signals(state,'2025-01-02',[{'symbol':'ABC','signal':'SELL'}],{'ABC':100})
        self.assertEqual(len(state['pending_orders']),0)

    def test_mark_to_market_reconciles_cash_and_investment(self):
        state=initial_state({'starting_capital':100000,'max_position_pct':.2})
        state=queue_signals(state,'2025-01-02',[{'symbol':'ABC','signal':'BUY','industry':'Tech'}],{'ABC':100})
        state=process_open(state,'2025-01-03',{'ABC':101})
        state=mark_to_market(state,'2025-01-03',{'ABC':105})
        last=state['equity_history'][-1]
        self.assertAlmostEqual(last['equity'],state['cash']+last['invested'],places=2)

    def test_same_day_mark_to_market_is_idempotent(self):
        state=initial_state({'starting_capital':100000})
        state=mark_to_market(state,'2025-01-03',{})
        state=mark_to_market(state,'2025-01-03',{})
        self.assertEqual(len([x for x in state['equity_history'] if x['date']=='2025-01-03']),1)

if __name__ == '__main__': unittest.main()
