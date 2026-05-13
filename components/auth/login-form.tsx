"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="username">
          Kullanici ID
        </label>
        <input
          autoComplete="username"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
          id="username"
          name="username"
          required
          type="text"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="password">
          Sifre
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-primary"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>

      {state.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Giris yapiliyor" : "Giris yap"}
      </Button>
    </form>
  );
}
