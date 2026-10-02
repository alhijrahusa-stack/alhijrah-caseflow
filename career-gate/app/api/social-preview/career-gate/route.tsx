import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          color: "#F8FAFC",
          background: "linear-gradient(135deg,#06111F 0%,#0A2036 58%,#0B2A3D 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "0",
            display: "flex",
            background: "radial-gradient(circle at 84% 12%,rgba(214,179,74,.20),transparent 34%),radial-gradient(circle at 14% 88%,rgba(69,215,221,.16),transparent 36%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "28px",
            display: "flex",
            border: "1px solid rgba(242,217,129,.26)",
            borderRadius: "34px",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "68px 82px 62px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", color: "#9AF4F6", fontSize: "20px", fontWeight: 700, letterSpacing: "5px" }}>
                OFFICIAL EMPLOYMENT PORTAL
              </div>
              <div style={{ display: "flex", marginTop: "10px", color: "#F2D981", fontSize: "66px", fontWeight: 800, lineHeight: 1 }}>
                Career Gate
              </div>
            </div>
            <div
              style={{
                width: "112px",
                height: "112px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "30px",
                color: "#07101F",
                background: "linear-gradient(145deg,#F5DE8D,#C89925)",
                fontSize: "49px",
                fontWeight: 800,
              }}
            >
              CG
            </div>
          </div>

          <div
            dir="rtl"
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "flex-end",
              color: "#FFFFFF",
              fontSize: "55px",
              fontWeight: 800,
              lineHeight: 1.35,
              textAlign: "right",
            }}
          >
            بوابة التوظيف والتقديم ومتابعة الطلبات
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "24px",
              borderTop: "1px solid rgba(255,255,255,.14)",
            }}
          >
            <div style={{ display: "flex", color: "#F6F8FB", fontSize: "24px", fontWeight: 700 }}>
              ALHIJRAH SERVICES LLC
            </div>
            <div style={{ display: "flex", color: "#9EB0C4", fontSize: "20px", fontWeight: 600 }}>
              Apply • Track • Complete
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
