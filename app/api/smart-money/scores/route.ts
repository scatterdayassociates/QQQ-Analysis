import { NextRequest, NextResponse } from "next/server";

// Mock data generator for development/testing (when backend unavailable)
function generateMockScores() {
  const nasdaq100Tickers = [
    "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL", "GOOG", "AVGO", "NFLX",
    "QCOM", "ADBE", "CRM", "INTC", "INTU", "AMD", "CSCO", "CMCSA", "PEP", "COST",
    "AZO", "ASML", "TMUS", "NXPI", "AMAT", "LRCX", "MRNA", "SNPS", "CDNS", "JD",
    "CHTR", "BIIB", "KLAC", "PYPL", "ABNB", "VRSK", "SPLK", "ARM", "ORCL", "LULU",
    "CRWD", "DDOG", "OKTA", "PANW", "FTNT", "NET", "MSTR", "COIN", "SQ", "SHOP",
    "CCIV", "DMTK", "DASH", "ROKU", "CSGP", "SGEN", "ALRM", "OSCR", "MCHP", "PLUG",
    "XPEV", "NIO", "BIDU", "BKNG", "EXPE", "TRIP", "VRSN", "DOCU", "PSTG", "JBLU",
    "LYFT", "UBER", "RBLX", "PTON", "ZM", "ZPAY", "UPST", "SNOW", "DKNG", "CPRT",
    "ENPH", "SEDG", "RUN", "DNLI", "FSLR", "MAXR", "TXRH", "BBKP", "BLKB", "ANET",
    "SCCO", "RGEN", "VEEV", "PD", "PAYC", "AEP", "LYV", "MULE", "JKHY", "ALKS",
  ];

  const now = new Date();
  const formattedDate = now.toISOString().split("T")[0];

  return nasdaq100Tickers.slice(0, 50).map((ticker, idx) => ({
    ticker,
    composite_score: Math.random() * 100,
    insider_cluster_score: Math.random() * 100,
    activist_flag_score: Math.random() * 100,
    cot_zscore: (Math.random() - 0.5) * 200,
    short_interest_momentum_score: Math.random() * 100,
    thirteenf_conviction_score: Math.random() * 100,
    as_of_date: formattedDate,
  }));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const universe = searchParams.get("universe") || "Nasdaq-100";
    const funds = searchParams.get("funds") || "Citadel,Millennium,Point72";
    const weightsParam = searchParams.get("weights");

    // Parse weights if provided
    let weights = {
      insider: 25,
      activist: 15,
      cot: 20,
      short_interest: 15,
      thirteenf: 25,
    };

    if (weightsParam) {
      try {
        weights = JSON.parse(weightsParam);
      } catch (e) {
        console.warn("Invalid weights JSON, using defaults");
      }
    }

    // Try to call the Python backend API
    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:8000";
    const queryParams = new URLSearchParams({
      universe,
      funds,
      ...(weightsParam && { weights: weightsParam }),
    });

    try {
      const backendResponse = await fetch(
        `${backendUrl}/api/smart-money/scores?${queryParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        }
      );

      if (backendResponse.ok) {
        const backendData = await backendResponse.json();
        return NextResponse.json(backendData);
      } else {
        console.warn(
          `Backend API returned ${backendResponse.status}, falling back to mock data`
        );
      }
    } catch (backendError) {
      console.warn(
        `Backend API unavailable (${backendError instanceof Error ? backendError.message : "Unknown error"}), using mock data`
      );
    }

    // Fall back to mock data
    const scores = generateMockScores();

    return NextResponse.json({
      universe,
      funds: funds.split(","),
      weights,
      scores,
      timestamp: new Date().toISOString(),
      note: "Using mock data. Backend API unavailable or not configured.",
      backend_url: backendUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
