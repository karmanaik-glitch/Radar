"""Normalise a user-supplied constituent CSV; deliberately does not scrape exchange sites."""
import argparse
from pathlib import Path
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='Path to a permitted Nifty 500 constituent CSV')
    parser.add_argument('--output', default='data/universe.csv')
    args = parser.parse_args()
    df = pd.read_csv(args.source)
    columns = {str(c).strip().lower(): c for c in df.columns}
    symbol_col = next((columns[k] for k in ('symbol', 'ticker', 'tradingsymbol') if k in columns), None)
    if not symbol_col:
        raise SystemExit('CSV must contain a Symbol/Ticker/TradingSymbol column.')
    industry_col = next((columns[k] for k in ('industry', 'sector', 'industry name') if k in columns), None)
    company_col = next((columns[k] for k in ('company name', 'company', 'name') if k in columns), None)
    out = pd.DataFrame({'symbol': df[symbol_col].astype(str).str.strip().str.upper()})
    out['symbol'] = out['symbol'].str.replace(r'\.NS$', '', regex=True)
    out['company'] = df[company_col].astype(str).str.strip() if company_col else out['symbol']
    out['industry'] = df[industry_col].astype(str).str.strip() if industry_col else 'Unknown'
    out = out[out.symbol.str.fullmatch(r'[A-Z0-9&_-]+', na=False)].drop_duplicates('symbol').sort_values('symbol')
    if len(out) < 400:
        print(f'WARNING: only {len(out)} unique symbols found. This does not look like a complete Nifty 500 universe.')
    if len(out) > 550:
        raise SystemExit(f'Refusing unexpected universe size: {len(out)} symbols.')
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, index=False)
    print(f'Wrote {len(out)} symbols to {args.output}')

if __name__ == '__main__':
    main()
