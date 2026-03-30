import Image from "next/image";

const banners = [
  {
    title: "Daily Jackpot",
    src: "/jackpot-daily-banner.svg",
    accent: "from-amber-300/30 via-orange-400/10 to-transparent",
    copy: "Hotter, faster, louder. This direction pushes arcade energy and gold-rush pressure instead of a generic chest-on-grey background.",
  },
  {
    title: "Weekly Jackpot",
    src: "/jackpot-weekly-banner.svg",
    accent: "from-fuchsia-300/30 via-sky-300/10 to-transparent",
    copy: "Heavier and more prestigious. The weekly banner reads like a mythic vault reward, not just the daily banner recolored purple.",
  },
];

export default function JackpotBannersPage() {
  return (
    <main className="min-h-screen bg-[#07070d] px-6 py-10 text-white">
      <div className="mx-auto max-w-[1640px]">
        <div className="mb-8 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.34em] text-white/45">LORE / Jackpot Art Pass</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">
            Daily and weekly jackpot banners with actual game-promo energy
          </h1>
          <p className="mt-4 max-w-4xl text-base leading-7 text-white/70 sm:text-lg">
            Figma MCP hit the Starter-plan call cap, so these were produced as local production-ready SVG assets. The main change is direction:
            daily is brighter and more explosive, weekly is darker, rarer, and more premium.
          </p>
        </div>

        <div className="space-y-8">
          {banners.map((banner) => (
            <section
              key={banner.src}
              className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d0d16] shadow-[0_30px_80px_rgba(0,0,0,0.4)]"
            >
              <div className={`h-1 w-full bg-gradient-to-r ${banner.accent}`} />
              <div className="border-b border-white/8 px-6 py-5">
                <h2 className="text-2xl font-black tracking-[-0.03em]">{banner.title}</h2>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-white/65 sm:text-base">{banner.copy}</p>
              </div>
              <div className="bg-[#08080f] p-4 sm:p-6">
                <Image
                  src={banner.src}
                  alt={banner.title}
                  width={1600}
                  height={600}
                  className="w-full rounded-[26px] border border-white/8 bg-black/30"
                />
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
