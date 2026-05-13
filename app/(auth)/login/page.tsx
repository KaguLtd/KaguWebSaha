import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4">
      <section className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Kagu Saha Giris</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Yetkili hesabinla giris yap. Yonetici ve personel otomatik olarak kendi alanina yonlendirilir.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
