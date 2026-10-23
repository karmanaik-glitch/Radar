"""Explainable market-context rules adapted for STRATA; heuristic, not predictive probabilities."""
from __future__ import annotations
from collections import defaultdict

RULESET_VERSION = 'strata-rules-0.2.0'


def classify_market_regime(*, benchmark_return_20d=None, pct_above_sma50=None,
                           pct_above_sma200=None, average_rsi=None, average_adx=None,
                           volatility_change_20d=None, minimum_evidence=3):
    """Classify broad conditions. Missing components are omitted, not fabricated."""
    parts, missing = {}, []
    if benchmark_return_20d is not None:
        parts['trend'] = max(-1.0, min(1.0, float(benchmark_return_20d) / 8.0))
    else: missing.append('benchmark_return_20d')
    breadth = []
    for key, value in [('sma50', pct_above_sma50), ('sma200', pct_above_sma200)]:
        if value is None: missing.append(f'pct_above_{key}')
        else: breadth.append((float(value) - 50.0) / 50.0)
    if breadth: parts['breadth'] = sum(breadth) / len(breadth)
    if average_rsi is not None: parts['rsi_momentum'] = max(-1.0, min(1.0, (float(average_rsi)-50.0)/25.0))
    else: missing.append('average_rsi')
    # ADX measures trend strength, not direction; do not award it a bullish score by itself.
    if volatility_change_20d is not None: parts['volatility_penalty'] = max(-1.0, min(1.0, float(volatility_change_20d)/20.0))
    weights = {'trend':40, 'breadth':35, 'rsi_momentum':25, 'volatility_penalty':-10}
    usable = {k:v for k,v in parts.items() if k in weights}
    # Renormalize over available weighted evidence so missing fields don't become fake neutral observations.
    denom = sum(abs(weights[k]) for k in usable)
    score = round(max(-100, min(100, sum(usable[k]*weights[k] for k in usable) / denom * 100)), 1) if denom else None
    enough = len([k for k in usable if k != 'volatility_penalty']) >= minimum_evidence
    if not enough or score is None: label = 'INSUFFICIENT DATA'
    elif score >= 45: label = 'STRONG RISK-ON'
    elif score >= 15: label = 'RISK-ON'
    elif score <= -45: label = 'STRONG RISK-OFF'
    elif score <= -15: label = 'RISK-OFF'
    else: label = 'NEUTRAL'
    return {'label':label, 'score':score, 'components':parts, 'missing_evidence':missing,
            'method':'heuristic; not a forecast or probability'}


def sector_rotation(rows):
    """Summarize industry/sector evidence from available signal rows."""
    groups = defaultdict(list)
    for row in rows:
        if row.get('data_quality') == 'BLOCKED': continue
        sector = str(row.get('industry') or 'Unknown').strip() or 'Unknown'
        groups[sector].append(row)
    output=[]
    for sector, items in groups.items():
        returns=[float(x['change_pct']) for x in items if isinstance(x.get('change_pct'),(int,float))]
        scores=[float(x['score']) for x in items if isinstance(x.get('score'),(int,float))]
        bullish=sum(x.get('signal')=='BUY' for x in items)
        bearish=sum(x.get('signal')=='SELL' for x in items)
        breadth=(sum(x.get('technical',{}).get('Close',0)>x.get('technical',{}).get('SMA50',float('inf')) for x in items if x.get('technical',{}).get('SMA50') is not None)/len([x for x in items if x.get('technical',{}).get('SMA50') is not None])*100) if any(x.get('technical',{}).get('SMA50') is not None for x in items) else None
        avg1=sum(returns)/len(returns) if returns else None
        avgscore=sum(scores)/len(scores) if scores else None
        # One-day return is intentionally low-weight; this is a descriptive heuristic only.
        composite=(avg1 or 0)*0.15 + ((avgscore if avgscore is not None else 50)-50)*0.25 + ((breadth if breadth is not None else 50)-50)*0.15
        if composite>=4: state='ACCELERATING'
        elif composite>=1: state='IMPROVING'
        elif composite<=-4: state='DECLINING'
        elif composite<=-1: state='WEAKENING'
        else: state='NEUTRAL'
        output.append({'industry':sector,'symbols':len(items),'avg_change_1d_pct':round(avg1,2) if avg1 is not None else None,
            'avg_setup_score':round(avgscore,1) if avgscore is not None else None,'breadth_above_sma50_pct':round(breadth,1) if breadth is not None else None,
            'bullish_setups':bullish,'bearish_setups':bearish,'rotation':state,'method':'descriptive heuristic; not a forecast'})
    return sorted(output,key=lambda x:(x['avg_setup_score'] if x['avg_setup_score'] is not None else -1),reverse=True)


def risk_plan(capital, risk_pct, entry, stop, target=None, max_capital_pct=100):
    """Risk-based position sizing. Inputs are assumed to use the same currency/unit."""
    try: capital,risk_pct,entry,stop=map(float,(capital,risk_pct,entry,stop))
    except (TypeError,ValueError): return {'valid':False,'reason':'Inputs must be numeric.'}
    if capital<=0 or risk_pct<=0 or risk_pct>100 or entry<=0 or stop<=0 or entry==stop:
        return {'valid':False,'reason':'Capital, risk %, entry and stop must be positive; risk must not exceed 100%; entry and stop must differ.'}
    budget=capital*risk_pct/100
    per_share=abs(entry-stop)
    qty=max(0,int(min(budget/per_share,capital*max_capital_pct/100/entry)))
    risk=qty*per_share
    reward=None; rr=None
    if target is not None:
        try:
            target=float(target)
            if target>0:
                reward=abs(target-entry)*qty
                rr=round(abs(target-entry)/per_share,2)
        except (TypeError,ValueError): pass
    return {'valid':True,'risk_budget':round(budget,2),'risk_per_share':round(per_share,4),'quantity':qty,
            'capital_required':round(qty*entry,2),'planned_risk':round(risk,2),'potential_reward':round(reward,2) if reward is not None else None,
            'risk_reward':rr,'method':'risk-based estimate before fees, slippage, gaps and liquidity constraints'}
