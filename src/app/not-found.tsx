import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Root 404, so a stray URL still looks like the app. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
      <Card className="w-full">
        <CardContent className="py-8 text-center">
          <h1 className="text-xl font-semibold">Page not found</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            That link doesn&apos;t go anywhere. If someone sent you an invite, it
            should look like{" "}
            <code className="font-mono text-xs">/join/…</code>.
          </p>
          <Button render={<Link href="/" />} className="mt-6">
            Go home
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
