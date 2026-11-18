import { useState, type FormEvent } from "react";
import { METHODS, PURCHASE_CATEGORIES, methodLabel, trpc, type MethodId, type PurchaseCategory, type PurchaseRow } from "./api";
import { Badge, Field, Notice, Panel, money, parseMoney, ref, todayInput } from "./ui";

// Facturas de compras: lo que Panter le paga a sus proveedores, y qué falta por pagar.
const monthName = (month: string) => new Intl.DateTimeFormat("es-VE", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.parse(`${month}-01T00:00:00Z`));
const dateLabel = (day: string) => new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.parse(`${day}T00:00:00Z`));

function PurchaseForm({ purchase, onDone }: { purchase?: PurchaseRow; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    supplier: purchase?.supplier ?? "",
    invoiceNumber: purchase?.invoiceNumber ?? "",
    invoiceDate: purchase?.invoiceDate ?? todayInput(),
    category: (purchase?.category ?? "Comida y bebidas") as PurchaseCategory,
    description: purchase?.description ?? "",
    total: purchase ? money(purchase.totalCents) : "",
    paid: purchase?.paid ?? false,
    method: (purchase?.method ?? "efectivo_usd") as MethodId,
    reference: purchase?.reference ?? "",
  });
  const save = trpc.office.purchaseSave.useMutation({ onSuccess: () => utils.office.purchases.invalidate().then(onDone) });
  const totalCents = parseMoney(form.total);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (totalCents === null) return;
    save.mutate({
      id: purchase?.id,
      supplier: form.supplier,
      invoiceNumber: form.invoiceNumber,
      invoiceDate: form.invoiceDate,
      category: form.category,
      description: form.description,
      totalCents,
      paid: form.paid,
      method: form.paid ? form.method : undefined,
      reference: form.reference,
    });
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="form__pair">
        <Field label="Proveedor">
          <input value={form.supplier} onChange={set("supplier")} required />
        </Field>
        <Field label="N.º de factura (opcional)">
          <input value={form.invoiceNumber} onChange={set("invoiceNumber")} />
        </Field>
      </div>
      <div className="form__pair">
        <Field label="Fecha de la factura">
          <input value={form.invoiceDate} onChange={set("invoiceDate")} type="date" required />
        </Field>
        <Field label="Monto en REF">
          <input value={form.total} onChange={set("total")} inputMode="decimal" placeholder="0,00" required />
        </Field>
      </div>
      <Field label="Categoría">
        <select value={form.category} onChange={set("category")}>
          {PURCHASE_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Qué se compró (opcional)">
        <input value={form.description} onChange={set("description")} placeholder="Harina, queso, refrescos…" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.paid} onChange={(e) => setForm((f) => ({ ...f, paid: e.target.checked }))} />
        Ya está pagada
      </label>
      {form.paid && (
        <div className="form__pair">
          <Field label="Con qué se pagó">
            <select value={form.method} onChange={set("method")}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Referencia (opcional)">
            <input value={form.reference} onChange={set("reference")} />
          </Field>
        </div>
      )}
      <Notice>{save.error?.message ?? (form.total && totalCents === null ? "Escribe el monto así: 80 o 80,50." : null)}</Notice>
      <div className="form__actions">
        <button className="btn" type="submit" disabled={save.isPending}>
          {purchase ? "Guardar cambios" : "Registrar factura"}
        </button>
        {purchase && (
          <button className="btn btn--ghost" type="button" onClick={onDone}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default function Purchases() {
  const utils = trpc.useUtils();
  const [month, setMonth] = useState(() => todayInput().slice(0, 7));
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const list = trpc.office.purchases.useQuery({ month });
  const remove = trpc.office.purchaseRemove.useMutation({ onSuccess: () => utils.office.purchases.invalidate() });
  const d = list.data;
  const rows = (d?.rows ?? []).filter((r) => !onlyPending || !r.paid);

  return (
    <div className="purchases">
      <Panel
        title="Facturas de compras"
        action={
          <Field label="Mes">
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
        }
      >
        {d && (
          <dl className="stats stats--wide">
            <div>
              <dt>Compras de {monthName(month)}</dt>
              <dd>{ref(d.totalCents)}</dd>
            </div>
            <div>
              <dt>Pagado</dt>
              <dd>{ref(d.paidCents)}</dd>
            </div>
            <div>
              <dt>Por pagar del mes</dt>
              <dd>{ref(d.pendingCents)}</dd>
            </div>
            <div>
              <dt>Por pagar en total</dt>
              <dd>
                {ref(d.owedAllCents)}
                {d.owedAllCount > 0 && (
                  <small>
                    {" "}
                    en {d.owedAllCount} {d.owedAllCount === 1 ? "factura" : "facturas"}
                  </small>
                )}
              </dd>
            </div>
          </dl>
        )}
        {editing === "new" ? (
          <PurchaseForm onDone={() => setEditing(null)} />
        ) : (
          <button className="btn" type="button" onClick={() => setEditing("new")}>
            Registrar una factura
          </button>
        )}
      </Panel>

      <Panel
        title={`Facturas de ${monthName(month)}`}
        action={
          <label className="check">
            <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
            Solo por pagar
          </label>
        }
      >
        <Notice>{list.error?.message ?? remove.error?.message}</Notice>
        {!d ? (
          <p className="empty">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="empty">{d.rows.length === 0 ? "No hay facturas registradas en este mes." : "Todas las facturas de este mes están pagadas."}</p>
        ) : (
          <ul className="bills">
            {rows.map((r) =>
              editing === r.id ? (
                <li key={r.id} className="bills__edit">
                  <PurchaseForm purchase={r} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={r.id}>
                  <div className="bills__main">
                    <strong>{r.supplier}</strong>
                    <small>
                      {dateLabel(r.invoiceDate)}, {r.category}
                      {r.invoiceNumber ? `, factura ${r.invoiceNumber}` : ""}
                    </small>
                    {r.description && <small>{r.description}</small>}
                  </div>
                  <div className="bills__side">
                    <strong>{ref(r.totalCents)}</strong>
                    {r.paid ? <Badge tone="ok">Pagada{r.method ? `, ${methodLabel(r.method)}` : ""}</Badge> : <Badge tone="warn">Por pagar</Badge>}
                  </div>
                  <div className="bills__actions">
                    <button className="app__link" type="button" onClick={() => setEditing(r.id)}>
                      {r.paid ? "Editar" : "Editar o marcar pagada"}
                    </button>
                    <button
                      className="app__link"
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`¿Borrar la factura de ${r.supplier} por ${ref(r.totalCents)}?`)) remove.mutate({ id: r.id });
                      }}
                    >
                      Borrar
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </Panel>
    </div>
  );
}
