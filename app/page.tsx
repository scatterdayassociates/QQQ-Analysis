import DashboardTabs from "@/components/DashboardTabs";

export default function Home() {
  return (
    <main className="page">
      <p className="eyebrow">Scatterday Associates · QQQ / TQQQ</p>
      <h2 className="site-title">TQQQ / QQQ Options Trading Analytics</h2>
      <DashboardTabs />
    </main>
  );
}
