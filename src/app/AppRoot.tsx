import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, trpcClient } from "./api";
import Account from "./Account";
import Staff from "./Staff";
import "../styles/app.css";

export default function AppRoot() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: true } } }));
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
