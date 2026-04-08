import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0612] px-6">
      <div className="max-w-md w-full text-center">
        <div className="text-7xl mb-4 font-mono font-black text-violet-500/30">404</div>
        <h1 className="text-xl font-bold uppercase tracking-wider text-white mb-2">
          Off the Lattice
        </h1>
        <p className="text-sm text-gray-300 mb-6 leading-relaxed">
          This block was never mined. The chain has no record of this path.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md border border-violet-500/40 bg-violet-500/10 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-violet-200 hover:bg-violet-500/20 transition-colors"
        >
          Return to mining
        </Link>
      </div>
    </div>
  );
}
