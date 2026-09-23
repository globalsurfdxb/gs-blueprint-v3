import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const redirectTo = from && from.startsWith("/") ? from : "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gs-light px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 bg-gs-red" aria-hidden />
            <h1 className="font-heading text-lg font-semibold">GS Blueprint</h1>
          </div>
          <p className="mt-1.5 font-body text-sm text-gs-gray">
            Where your projects, tasks, and time live.
          </p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </div>
    </div>
  );
}
