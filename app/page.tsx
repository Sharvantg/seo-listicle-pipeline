import InputForm from "@/components/InputForm";

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold">New Listicle</h2>
        <p className="text-muted-foreground mt-1">
          Enter your target keywords and the pipeline will research, discover tools, generate a
          draft, evaluate it, and push to Webflow.
        </p>
      </div>

      <InputForm />
    </div>
  );
}
