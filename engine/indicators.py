"""Small, explicit indicator implementation to keep calculations auditable."""
import numpy as np
import pandas as pd


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    result = 100 - (100 / (1 + rs))
    return result.where(loss.ne(0), 100.0)


def enrich_ohlcv(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy().sort_index()
    close = df['Close'].astype(float)
    df['SMA20'] = close.rolling(20, min_periods=20).mean()
    df['SMA50'] = close.rolling(50, min_periods=50).mean()
    df['SMA200'] = close.rolling(200, min_periods=200).mean()
    df['RSI14'] = rsi(close)
    fast = close.ewm(span=12, adjust=False, min_periods=12).mean()
    slow = close.ewm(span=26, adjust=False, min_periods=26).mean()
    df['MACD'] = fast - slow
    df['MACD_SIGNAL'] = df['MACD'].ewm(span=9, adjust=False, min_periods=9).mean()
    df['ATR14'] = pd.concat([
        df['High'] - df['Low'],
        (df['High'] - df['Close'].shift()).abs(),
        (df['Low'] - df['Close'].shift()).abs(),
    ], axis=1).max(axis=1).rolling(14, min_periods=14).mean()
    df['VOLUME_SMA20'] = df['Volume'].rolling(20, min_periods=20).mean()
    df['VOLUME_RATIO20'] = df['Volume'] / df['VOLUME_SMA20'].replace(0, np.nan)
    df['RETURN_1D'] = close.pct_change() * 100
    df['RETURN_20D'] = close.pct_change(20) * 100
    df['BB_MID20'] = close.rolling(20, min_periods=20).mean()
    bb_std = close.rolling(20, min_periods=20).std(ddof=0)
    df['BB_UPPER20'] = df['BB_MID20'] + 2 * bb_std
    df['BB_LOWER20'] = df['BB_MID20'] - 2 * bb_std
    up_move = df['High'].diff()
    down_move = -df['Low'].diff()
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
    tr = pd.concat([df['High'] - df['Low'], (df['High'] - df['Close'].shift()).abs(), (df['Low'] - df['Close'].shift()).abs()], axis=1).max(axis=1)
    atr_wilder = tr.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1/14, min_periods=14, adjust=False).mean() / atr_wilder.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(alpha=1/14, min_periods=14, adjust=False).mean() / atr_wilder.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    df['ADX14'] = dx.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    df['PLUS_DI14'] = plus_di
    df['MINUS_DI14'] = minus_di
    return df
