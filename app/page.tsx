import DaypartPanel from "@/components/DaypartPanel";

export default function Home() {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Scatterday Associates · QQQ / TQQQ</p>
          <h1>Intraday Daypart — Volume &amp; VIX</h1>
          <p className="subtitle">
            15-minute buckets across the regular session (9:30 AM–4:00 PM ET), with VIX plotted as a
            market-wide proxy for implied volatility.
          </p>
        </div>
      </div>

      <DaypartPanel />

      <p className="footnote">
        <strong>Methodology.</strong> VIX (CBOE Volatility Index) stands in for implied volatility on
        both QQQ and TQQQ because IV itself is a property of an individual option contract, not the
        underlying ticker. Volume and VIX are read from the Massive Custom Bars endpoint in 15-minute
        buckets, Eastern Time.
      </p>
    </main>
  );
}
