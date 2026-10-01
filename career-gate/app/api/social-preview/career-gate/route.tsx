import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const careerGateLogo = `${origin}/brand/career-gate.webp`;
  const officeLogo = `${origin}/brand/alhijrah-services.webp`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          color: "#F6F8FB",
          background:
            "linear-gradient(135deg,#04101E 0%,#071A2D 42%,#0D263A 72%,#081321 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "0",
            display: "flex",
            background:
              "radial-gradient(circle at 18% 16%,rgba(69,215,221,.22),transparent 32%),radial-gradient(circle at 82% 14%,rgba(214,179,74,.18),transparent 30%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "48px",
            right: "48px",
            top: "38px",
            height: "2px",
            display: "flex",
            background: "linear-gradient(90deg,transparent,#D6B34A,#45D7DD,transparent)",
            opacity: 0.9,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "58px",
            right: "58px",
            bottom: "42px",
            height: "2px",
            display: "flex",
            background: "linear-gradient(90deg,transparent,#45D7DD,#D6B34A,transparent)",
            opacity: 0.75,
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "66px 76px 62px",
            gap: "58px",
          }}
        >
          <div
            style={{
              width: "430px",
              height: "430px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "42px",
              background: "linear-gradient(145deg,#FFFFFF 0%,#F7F8FA 100%)",
              border: "1px solid rgba(255,255,255,.78)",
              boxShadow: "0 28px 70px rgba(0,0,0,.34)",
            }}
          >
            <img
              src={careerGateLogo}
              alt="Career Gate"
              width="382"
              height="382"
              style={{ objectFit: "contain" }}
            />
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#9AF4F6",
                fontSize: "23px",
                fontWeight: 700,
                letterSpacing: "5px",
                marginBottom: "14px",
              }}
            >
              CAREER GATE
            </div>
            <div
              style={{
                display: "flex",
                color: "#F2D981",
                fontSize: "54px",
                fontWeight: 800,
                lineHeight: 1.12,
                marginBottom: "20px",
              }}
            >
              Employment Portal
            </div>
            <div
              dir="rtl"
              style={{
                display: "flex",
                width: "100%",
                color: "#F6F8FB",
                fontSize: "46px",
                fontWeight: 800,
                lineHeight: 1.32,
                marginBottom: "32px",
                textAlign: "right",
                justifyContent: "flex-end",
              }}
            >
              بوابة التوظيف عبر مكتب الهجرة
            </div>

            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "18px",
                padding: "18px 22px",
                borderRadius: "22px",
                border: "1px solid rgba(69,215,221,.38)",
                background: "rgba(10,25,41,.78)",
              }}
            >
              <img
                src={officeLogo}
                alt="AlHijrah Services LLC"
                width="72"
                height="72"
                style={{ objectFit: "contain", borderRadius: "16px" }}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    color: "#9EB0C4",
                    fontSize: "17px",
                    fontWeight: 700,
                    letterSpacing: "3px",
                    marginBottom: "5px",
                  }}
                >
                  OFFICIAL SERVICE
                </div>
                <div
                  style={{
                    display: "flex",
                    color: "#F6F8FB",
                    fontSize: "27px",
                    fontWeight: 800,
                  }}
                >
                  ALHIJRAH SERVICES LLC
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
