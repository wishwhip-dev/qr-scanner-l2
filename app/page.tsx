import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Ready to build
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Describe this application in the task goal.
      </h1>
      <p className="text-lg text-muted-foreground">
        The coding agent will replace this reviewed starter with the requested product.
      </p>
      <div className="mt-2 flex gap-2">
        <Button>Web app foundation ready</Button>
      </div>
    </main>
  );
}
