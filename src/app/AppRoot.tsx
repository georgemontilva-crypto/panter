import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, trpcClient } from "./api";
import Account from "./Account";
import Staff from "./Staff";
import "../styles/app.css";

export default function AppRoot() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: true } } }));
  // Por si se llega aquí con la página de fondo congelada por el menú de la portada.
  useEffect(() => {
    document.body.classList.remove("no-scroll");
  }, []);
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="cuenta" element={<Account />} />
          <Route path="caja" element={<Staff />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
