import ClipFilters from "@/components/ClipFilters";
import ClipList from "@/components/ClipList";
import { supabase } from "@/lib/supabaseClient";
import { Clip } from "@/types";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export const revalidate = 0;

export default async function Page({ searchParams }: PageProps) {
  const species = getParam(searchParams?.species);
  const minAnimals = getParam(searchParams?.minAnimals);
  const startDate = getParam(searchParams?.startDate);
  const endDate = getParam(searchParams?.endDate);

  // Distinct species for filter dropdown (deduped in JS to keep the query simple).
  const { data: speciesRows } = await supabase.from("clips").select("primary_species");
  const speciesOptions = Array.from(
    new Set((speciesRows || []).map((row) => row.primary_species).filter(Boolean)),
  ) as string[];

  let query = supabase
    .from("clips")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(200);

  if (species) query = query.eq("primary_species", species);
  if (minAnimals) query = query.gte("max_animals", Number(minAnimals));
  if (startDate) query = query.gte("started_at", startDate);
  if (endDate) query = query.lte("started_at", `${endDate}T23:59:59Z`);

  const { data: clips, error } = await query;

  return (
    <div className="space-y-6">
      <ClipFilters speciesOptions={speciesOptions} />
      {error ? (
        <div className="glass rounded-xl p-4 border border-red-500/40 text-red-200">
          Failed to load clips: {error.message}
        </div>
      ) : (
        <ClipList clips={(clips || []) as Clip[]} />
      )}
    </div>
  );
}
