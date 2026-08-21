import { BookOpenText, Compass } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <main className="paper-grain grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-lg rounded-[2rem] border border-[#d7c6a7] bg-[#fbf6e9]/95 p-8 text-center shadow-[0_24px_70px_rgba(37,57,78,.16)] sm:p-10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#263f59] text-[#f4e7ca] shadow-lg">
          <BookOpenText size={30} />
        </div>
        <p className="mt-7 text-xs font-bold tracking-[.24em] text-[#9a702d]">404 · VELLUM TIDES</p>
        <h1 className="font-vellum mt-3 text-3xl font-black text-[#263f59]">這頁尚未落筆</h1>
        <p className="mt-4 leading-7 text-[#5a6270]">你翻到了一頁尚未編入歲時錄的紙頁；循著原來的流向，回到共讀的帳本吧。</p>
        <button onClick={handleGoHome} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#263f59] px-5 py-3 text-sm font-semibold text-[#fff8e9] transition active:scale-[.98]">
          <Compass size={16} />回到帳頁
        </button>
      </section>
    </main>
  );
}
