"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  speciesOptions: string[];
};

export default function ClipFilters({ speciesOptions }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [species, setSpecies] = useState(searchParams.get("species") || "");
  const [minAnimals, setMinAnimals] = useState(searchParams.get("minAnimals") || "");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") || "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") || "");

  useEffect(() => {
    setSpecies(searchParams.get("species") || "");
    setMinAnimals(searchParams.get("minAnimals") || "");
    setStartDate(searchParams.get("startDate") || "");
    setEndDate(searchParams.get("endDate") || "");
  }, [searchParams]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (species) params.set("species", species);
    if (minAnimals) params.set("minAnimals", minAnimals);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const query = params.toString();
    router.push(query ? `/?${query}` : "/");
  };

  const resetFilters = () => {
    setSpecies("");
    setMinAnimals("");
    setStartDate("");
    setEndDate("");
    router.push("/");
  };

  return (
    <form onSubmit={applyFilters} className="glass rounded-2xl p-4 border border-white/10">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-slate-400">Species</span>
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="">Any</option>
            {speciesOptions.map((sp) => (
              <option key={sp} value={sp}>
                {sp}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-slate-400">Min animals</span>
          <input
            type="number"
            min={0}
            value={minAnimals}
            onChange={(e) => setMinAnimals(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-100"
            placeholder="0"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-slate-400">Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-slate-400">End date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-100"
          />
        </label>
      </div>

      <div className="flex gap-3 justify-end mt-4">
        <button
          type="button"
          onClick={resetFilters}
          className="px-4 py-2 rounded-lg border border-white/20 text-slate-200 hover:border-white/40"
        >
          Reset
        </button>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-mint text-night font-semibold shadow-lg hover:translate-y-[-1px] transition"
        >
          Apply
        </button>
      </div>
    </form>
  );
}
