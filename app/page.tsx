import DaypartPanel from "@/components/DaypartPanel";

export default function Home() {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Scatterday Associates · QQQ / TQQQ</p>
          <h1>Intraday Daypart — Volume &amp; Realized Volatility</h1>
          <p className="subtitle">
            15-minute buckets across the regular session (9:30 AM–4:00 PM ET), with a realized-volatility
            proxy plotted alongside QQQ/TQQQ volume.
          </p>
        </div>
      </div>

      <DaypartPanel />

      <p className="footnote">
        <strong>Methodology.</strong> The volatility line uses the Parkinson range estimator — computed
        from each 15-minute QQQ bar&apos;s own high/low and annualized to a percentage — as a stand-in for
        implied volatility. True IV belongs to individual option contracts (strike + expiry), not the
        underlying ticker, and a market-wide index like VIX is billed as a separate Indices subscription;
        this proxy needs neither, since it&apos;s derived entirely from the QQQ volume data already being
        fetched. It is <em>realized</em> (backward-looking, from price ranges), not <em>implied</em>
        (forward-looking, from option prices) volatility. Volume and price ranges are read from the
        Massive Custom Bars endpoint in 15-minute buckets, Eastern Time.
      </p>
    </main>
  );
}
