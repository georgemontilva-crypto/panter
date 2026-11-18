import { useState, type FormEvent } from "react";
import { METHODS, QUOTE_LABEL, methodLabel, trpc, type MethodId, type PartyPackage, type QuoteDetail, type QuoteStatus, type QuoteSummary } from "./api";
import { Badge, DocSheet, Field, Notice, Panel, clock, dayName, duration, fromLocalInput, money, parseMoney, ref, toLocalInput, when } from "./ui";
import { PantherMark } from "../components/Logo";
import { site } from "../content";

// Fiestas: cotizaciones con su estado, agenda, pagos y recibos.
// El camino de una cotización: Borrador → Enviada → Aprobada → Agendada → Realizada.
const STEPS: QuoteStatus[] = ["draft", "sent", "approved", "scheduled", "done"];
const TONE: Record<QuoteStatus, "plain" | "ok" | "warn" | "hot" | "off"> = { draft: "plain", sent: "warn", approved: "hot", scheduled: "ok", done: "plain", cancelled: "off" };
// El paso que sigue, dicho como lo diría quien atiende al cliente.
const FORWARD: Partial<Record<QuoteStatus, { to: QuoteStatus; label: string }>> = {
  draft: { to: "sent", label: "Ya se la envié al cliente" },
  sent: { to: "approved", label: "El cliente la aprobó" },
  approved: { to: "scheduled", label: "Agendar la fiesta" },
  scheduled: { to: "done", label: "La fiesta ya se hizo" },
};
const BACK: Partial<Record<QuoteStatus, { to: QuoteStatus; label: string }>> = {
  sent: { to: "draft", label: "Volver a borrador" },
  approved: { to: "sent", label: "Quitar la aprobación" },
  scheduled: { to: "approved", label: "Quitar de la agenda" },
  done: { to: "scheduled", label: "Todavía no se hizo" },
  cancelled: { to: "draft", label: "Reabrir como borrador" },
};
const DURATIONS = [60, 90, 120, 150, 180, 240, 300, 360];

const payState = (q: { totalCents: number; paidCents: number }) =>
  q.totalCents > 0 && q.paidCents >= q.totalCents ? "Pagada" : q.paidCents > 0 ? `Abonó ${ref(q.paidCents)}` : "Sin pago";
const partyTime = (q: { eventAt: number | null; durationMinutes: number }) =>
  q.eventAt ? `${dayName(q.eventAt)}, de ${clock(q.eventAt)} a ${clock(q.eventAt + q.durationMinutes * 60_000)}` : "Sin fecha todavía";

// ---------- Editor ----------
type Line = { description: string; qty: string; price: string };
const emptyLine = (): Line => ({ description: "", qty: "1", price: "" });

function QuoteEditor({ quote, onDone, onCancel }: { quote?: QuoteDetail; onDone: (id: number) => void; onCancel: () => void }) {
  const utils = trpc.useUtils();
  const packages = trpc.office.packages.useQuery();
  const [form, setForm] = useState({
    customerName: quote?.customerName ?? "",
    customerPhone: quote?.customerPhone ?? "",
    customerEmail: quote?.customerEmail ?? "",
    occasion: quote?.occasion ?? "",
    eventAt: toLocalInput(quote?.eventAt ?? null),
    durationMinutes: quote?.durationMinutes ?? 120,
    guests: String(quote?.guests ?? 10),
    notes: quote?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() =>
    quote ? quote.items.map((i) => ({ description: i.description, qty: String(i.qty), price: money(i.unitCents) })) : [emptyLine()],
  );
  const [problem, setProblem] = useState("");
  const done = { onSuccess: (r: { id: number }) => utils.office.invalidate().then(() => onDone(r.id)) };
  const create = trpc.office.quoteCreate.useMutation(done);
  const update = trpc.office.quoteUpdate.useMutation(done);
  const saving = create.isPending || update.isPending;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setLine = (index: number, patch: Partial<Line>) => setLines((all) => all.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const centsOf = (line: Line) => {
    const text = line.price.trim();
    const cents = parseMoney(text.replace(/^-/, ""));
    return cents === null ? null : text.startsWith("-") ? -cents : cents;
  };
  const total = lines.reduce((sum, line) => sum + (centsOf(line) ?? 0) * (Number(line.qty) || 0), 0);

  // Elegir un paquete lo pone como primer renglón y trae su duración e invitados.
  const usePackage = (pack: PartyPackage) => {
    const line = { description: `Paquete ${pack.name}`, qty: "1", price: money(pack.priceCents) };
    setLines((all) => {
      const rest = all.filter((l, i) => !(i === 0 && l.description.startsWith("Paquete ")) && (l.description.trim() || l.price.trim()));
      return [line, ...rest];
    });
    setForm((f) => ({ ...f, durationMinutes: pack.durationMinutes, guests: String(pack.guests) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem("");
    const filled = lines.filter((l) => l.description.trim() || l.price.trim());
    const items = [];
    for (const line of filled) {
      const unitCents = centsOf(line);
      if (!line.description.trim()) return setProblem("A un renglón le falta la descripción.");
      if (unitCents === null) return setProblem(`Escribe el precio de "${line.description}" así: 25 o 25,50.`);
      items.push({ description: line.description.trim(), qty: Math.max(1, Math.floor(Number(line.qty)) || 1), unitCents });
    }
    const input = {
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerEmail: form.customerEmail.trim(),
      occasion: form.occasion,
      eventAt: fromLocalInput(form.eventAt),
      durationMinutes: form.durationMinutes,
      guests: Math.floor(Number(form.guests)) || 0,
      notes: form.notes,
      items,
    };
    if (quote) update.mutate({ ...input, id: quote.id });
    else create.mutate(input);
  };

  const activePackages = (packages.data ?? []).filter((p) => p.active);
  return (
    <Panel title={quote ? `Editar ${quote.code}` : "Nueva cotización"}>
      <form className="form quote-form" onSubmit={submit}>
        <fieldset>
          <legend>Cliente</legend>
          <div className="form__pair">
            <Field label="Nombre de quien contrata">
              <input value={form.customerName} onChange={set("customerName")} autoComplete="off" required />
            </Field>
            <Field label="Teléfono" hint="Para enviarle la cotización por WhatsApp.">
              <input value={form.customerPhone} onChange={set("customerPhone")} type="tel" inputMode="tel" placeholder="0414 1234567" />
            </Field>
          </div>
          <Field label="Correo (opcional)">
            <input value={form.customerEmail} onChange={set("customerEmail")} type="email" inputMode="email" autoCapitalize="none" />
          </Field>
        </fieldset>

        <fieldset>
          <legend>La fiesta</legend>
          <Field label="Motivo" hint="Por ejemplo: cumpleaños de Mateo, 9 años.">
            <input value={form.occasion} onChange={set("occasion")} />
          </Field>
          <div className="form__pair">
            <Field label="Fecha y hora" hint="Puede quedar vacía hasta que el cliente decida.">
              <input value={form.eventAt} onChange={set("eventAt")} type="datetime-local" />
            </Field>
            <Field label="Duración">
              <select value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))}>
                {[...new Set([...DURATIONS, form.durationMinutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>
                    {duration(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Invitados">
            <input value={form.guests} onChange={set("guests")} inputMode="numeric" className="input--short" required />
          </Field>
        </fieldset>

        <fieldset>
          <legend>Qué incluye</legend>
          {activePackages.length > 0 && (
            <div className="packs">
              <p className="field__label">Empieza con un paquete</p>
              <div className="packs__list">
                {activePackages.map((p) => (
                  <button key={p.id} type="button" onClick={() => usePackage(p)}>
                    <strong>{p.name}</strong>
                    <span>{ref(p.priceCents)}</span>
                    <small>
                      {duration(p.durationMinutes)}, {p.guests} invitados
                    </small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="lines">
            {lines.map((line, i) => (
              <li key={i}>
                <Field label={i === 0 ? "Descripción" : "Extra o descuento"}>
                  <input value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder={i === 0 ? "Paquete o servicio" : "Pizza familiar, hora extra…"} />
                </Field>
                <Field label="Cant.">
                  <input value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" />
                </Field>
                <Field label="Precio REF">
                  <input value={line.price} onChange={(e) => setLine(i, { price: e.target.value })} inputMode="decimal" placeholder="0,00" />
                </Field>
                <button type="button" className="app__link lines__remove" onClick={() => setLines((all) => (all.length > 1 ? all.filter((_, n) => n !== i) : [emptyLine()]))} aria-label={`Quitar el renglón ${i + 1}`}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          <div className="lines__add">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setLines((all) => [...all, emptyLine()])}>
              Agregar un extra
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setLines((all) => [...all, { description: "Descuento", qty: "1", price: "-" }])}>
              Agregar un descuento
            </button>
          </div>
          <p className="field__hint">Un descuento es un renglón con el precio en negativo, por ejemplo -10.</p>
          <p className="quote-form__total">
            <span>Total</span>
            <strong>{ref(total)}</strong>
          </p>
        </fieldset>

        <Field label="Notas para el cliente (opcional)" hint="Salen en la cotización: condiciones, qué pueden traer, hasta cuándo vale el precio.">
          <textarea value={form.notes} onChange={set("notes")} rows={3} />
        </Field>

        <Notice>{problem || create.error?.message || update.error?.message}</Notice>
        <div className="form__actions">
          <button className="btn" type="submit" disabled={saving}>
            {quote ? "Guardar cambios" : "Guardar cotización"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </Panel>
  );
}

// ---------- Documento: cotización o recibo ----------
function QuoteDocument({ quote, kind }: { quote: QuoteDetail; kind: "quote" | "receipt" }) {
  const pending = quote.totalCents - quote.paidCents;
  return (
    <article className="doc">
      <header className="doc__head">
        <div className="doc__brand">
          <PantherMark className="doc__mark" />
          <div>
            <strong>Arena Panter</strong>
            <span>Maracaibo{site.instagram ? `, @${site.instagram}` : ""}</span>
          </div>
        </div>
        <div className="doc__id">
          <strong>{kind === "receipt" ? `Recibo de pago ${quote.receipt}` : `Cotización ${quote.code}`}</strong>
          <span>{kind === "receipt" && quote.paidAt ? `Pagada el ${when(quote.paidAt)}` : `Emitida el ${when(quote.createdAt)}`}</span>
          {kind === "receipt" && <span>Cotización {quote.code}</span>}
        </div>
      </header>
      <dl className="doc__facts">
        <div>
          <dt>Cliente</dt>
          <dd>
            {quote.customerName}
            {quote.customerPhone ? `, ${quote.customerPhone}` : ""}
          </dd>
        </div>
        {quote.occasion && (
          <div>
            <dt>Motivo</dt>
            <dd>{quote.occasion}</dd>
          </div>
        )}
        <div>
          <dt>Fecha de la fiesta</dt>
          <dd>{quote.eventAt ? partyTime(quote) : "Por definir"}</dd>
        </div>
        <div>
          <dt>Invitados</dt>
          <dd>{quote.guests}</dd>
        </div>
      </dl>
      <table className="doc__table">
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Cant.</th>
            <th>Precio REF</th>
            <th>Importe REF</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item, i) => (
            <tr key={i}>
              <td>{item.description}</td>
              <td>{item.qty}</td>
              <td>{money(item.unitCents)}</td>
              <td>{money(item.unitCents * item.qty)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3}>Total</th>
            <td>{ref(quote.totalCents)}</td>
          </tr>
          {(kind === "receipt" || quote.paidCents > 0) && (
            <>
              <tr>
                <th colSpan={3}>Pagado</th>
                <td>{ref(quote.paidCents)}</td>
              </tr>
              {pending > 0 && (
                <tr>
                  <th colSpan={3}>Falta por pagar</th>
                  <td>{ref(pending)}</td>
                </tr>
              )}
            </>
          )}
        </tfoot>
      </table>
      {kind === "receipt" && quote.payments.length > 0 && (
        <div className="doc__block">
          <h3>Pagos recibidos</h3>
          <ul>
            {quote.payments.map((p) => (
              <li key={p.id}>
                {when(p.createdAt)}: {ref(p.amountCents)}, {methodLabel(p.method)}
                {p.reference ? `, ref. ${p.reference}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quote.notes && (
        <div className="doc__block">
          <h3>Notas</h3>
          <p>{quote.notes}</p>
        </div>
      )}
      <p className="doc__foot">
        {kind === "receipt"
          ? "Recibo de control interno de Arena Panter por el pago de esta fiesta. No sustituye a una factura fiscal."
          : "Los montos están en REF. La fecha se reserva cuando la cotización queda aprobada y agendada."}
      </p>
    </article>
  );
}

/** Texto listo para pegar en WhatsApp, y el enlace que lo abre con el número del cliente. */
function whatsapp(quote: QuoteDetail) {
  const lines = [
    `Hola ${quote.customerName.split(" ")[0]}, esta es tu cotización ${quote.code} de Arena Panter.`,
    quote.occasion ?? "",
    quote.eventAt ? `Fecha: ${partyTime(quote)}` : "",
    `Invitados: ${quote.guests}`,
    "",
    ...quote.items.map((i) => `${i.qty} x ${i.description}: ${ref(i.unitCents * i.qty)}`),
    `Total: ${ref(quote.totalCents)}`,
    quote.notes ? `\n${quote.notes}` : "",
  ].filter((line, i) => line !== "" || i === 4);
  const digits = (quote.customerPhone ?? "").replace(/\D/g, "");
  const number = digits.startsWith("0") ? `58${digits.slice(1)}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}

// ---------- Detalle ----------
function QuoteView({ id, onBack }: { id: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const query = trpc.office.quote.useQuery({ id });
  const refresh = { onSuccess: () => utils.office.invalidate() };
  const setStatus = trpc.office.quoteStatus.useMutation(refresh);
  const pay = trpc.office.quotePay.useMutation({
    onSuccess: () => {
      setAmount("");
      setReference("");
      return utils.office.invalidate();
    },
  });
  const removePayment = trpc.office.quotePaymentRemove.useMutation(refresh);
  const [editing, setEditing] = useState(false);
  const [doc, setDoc] = useState<"quote" | "receipt" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<MethodId>("efectivo_usd");
  const [reference, setReference] = useState("");

  const q = query.data;
  if (!q) return query.error ? <Notice>{query.error.message}</Notice> : <p className="empty">Cargando la cotización…</p>;
  if (editing) return <QuoteEditor quote={q} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  const pending = q.totalCents - q.paidCents;
  const forward = FORWARD[q.status];
  const back = BACK[q.status];
  const canPay = ["approved", "scheduled", "done"].includes(q.status) && pending > 0;
  const canEdit = q.status !== "done" && q.status !== "cancelled";
  const amountCents = amount.trim() ? parseMoney(amount) : pending;
  const step = STEPS.indexOf(q.status);
  const move = (to: QuoteStatus) => {
    pay.reset();
    setStatus.mutate({ id: q.id, status: to });
  };

  return (
    <div className="quote">
      <button className="app__link quote__back" type="button" onClick={onBack}>
        Volver a las cotizaciones
      </button>

      <Panel>
        <div className="quote__head">
          <div>
            <h2>
              {q.code} <Badge tone={TONE[q.status]}>{QUOTE_LABEL[q.status]}</Badge>
            </h2>
            <p className="quote__who">
              {q.customerName}
              {q.occasion ? `, ${q.occasion}` : ""}
            </p>
            <p className="quote__when">
              {partyTime(q)}, {q.guests} invitados
            </p>
          </div>
          <p className="quote__total">
            <strong>{ref(q.totalCents)}</strong>
            <span>{payState(q)}</span>
          </p>
        </div>

        {q.status !== "cancelled" && (
          <ol className="steps" aria-label="Avance de la cotización">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? "is-done" : i === step ? "is-now" : undefined} aria-current={i === step ? "step" : undefined}>
                {QUOTE_LABEL[s]}
              </li>
            ))}
          </ol>
        )}

        {q.clash.length > 0 && (
          <Notice kind="info">
            Ojo: a esa hora ya está agendada {q.clash.map((c) => `${c.code} (${c.customerName}, ${when(c.eventAt)})`).join(" y ")}.
          </Notice>
        )}
        <Notice>{setStatus.error?.message}</Notice>

        <div className="quote__actions">
          {forward && (
            <button className="btn" type="button" disabled={setStatus.isPending} onClick={() => move(forward.to)}>
              {forward.label}
            </button>
          )}
          {q.customerPhone && q.status !== "cancelled" && (
            <a className="btn btn--ghost" href={whatsapp(q)} target="_blank" rel="noreferrer">
              Enviar por WhatsApp
            </a>
          )}
          <button className="btn btn--ghost" type="button" onClick={() => setDoc("quote")}>
            Ver cotización para imprimir
          </button>
          {q.receipt && (
            <button className="btn btn--ghost" type="button" onClick={() => setDoc("receipt")}>
              Ver recibo {q.receipt}
            </button>
          )}
          {canEdit && (
            <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)}>
              Editar
            </button>
          )}
        </div>
        <div className="quote__minor">
          {back && (
            <button className="app__link" type="button" disabled={setStatus.isPending} onClick={() => move(back.to)}>
              {back.label}
            </button>
          )}
          {q.next.includes("cancelled") && (
            <button
              className="app__link"
              type="button"
              disabled={setStatus.isPending}
              onClick={() => {
                if (window.confirm(`¿Cancelar la cotización ${q.code}?${q.paidCents > 0 ? " Tiene pagos registrados: recuerda devolverlos y quitarlos." : ""}`)) move("cancelled");
              }}
            >
              Cancelar la cotización
            </button>
          )}
        </div>
      </Panel>

      <div className="quote__grid">
        <Panel title="Qué incluye">
          <ul className="rows">
            {q.items.map((item, i) => (
              <li key={i}>
                <span className="rows__main">
                  <strong>{item.qty > 1 ? `${item.qty} x ${item.description}` : item.description}</strong>
                  {item.qty > 1 && <small>{ref(item.unitCents)} cada uno</small>}
                </span>
                <span className="rows__side">{ref(item.unitCents * item.qty)}</span>
              </li>
            ))}
            <li className="rows__total">
              <span className="rows__main">
                <strong>Total</strong>
              </span>
              <span className="rows__side">{ref(q.totalCents)}</span>
            </li>
          </ul>
          {q.notes && <p className="quote__notes">{q.notes}</p>}
          <p className="form__lead">
            Creada el {when(q.createdAt)} por {q.createdByName}.{q.customerPhone ? ` Teléfono: ${q.customerPhone}.` : ""}
            {q.customerEmail ? ` Correo: ${q.customerEmail}.` : ""}
          </p>
        </Panel>

        <Panel title="Pagos">
          <dl className="stats">
            <div>
              <dt>Pagado</dt>
              <dd>{ref(q.paidCents)}</dd>
            </div>
            <div>
              <dt>Falta</dt>
              <dd>{ref(Math.max(0, pending))}</dd>
            </div>
          </dl>
          {q.payments.length > 0 && (
            <ul className="rows">
              {q.payments.map((p) => (
                <li key={p.id}>
                  <span className="rows__main">
                    <strong>{ref(p.amountCents)}</strong>
                    <small>
                      {when(p.createdAt)}, {methodLabel(p.method)}
                      {p.reference ? `, ref. ${p.reference}` : ""}, lo recibió {p.staff}
                    </small>
                  </span>
                  <button
                    className="app__link"
                    type="button"
                    disabled={removePayment.isPending}
                    onClick={() => {
                      if (window.confirm(`¿Quitar este pago de ${ref(p.amountCents)}? Úsalo solo si se registró por error o se devolvió el dinero.`)) removePayment.mutate({ paymentId: p.id });
                    }}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Notice>{removePayment.error?.message}</Notice>
          {canPay ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (amountCents) pay.mutate({ id: q.id, amountCents, method, reference });
              }}
            >
              <div className="form__pair">
                <Field label="Monto en REF" hint={`Vacío = todo lo que falta, ${ref(pending)}.`}>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={money(pending)} />
                </Field>
                <Field label="Forma de pago">
                  <select value={method} onChange={(e) => setMethod(e.target.value as MethodId)}>
                    {METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Referencia (opcional)">
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Notice>{pay.error?.message ?? (amount.trim() && amountCents === null ? "Escribe el monto así: 50 o 50,50." : null)}</Notice>
              <button className="btn" type="submit" disabled={pay.isPending || !amountCents}>
                Registrar pago {amountCents ? `de ${ref(amountCents)}` : ""}
              </button>
            </form>
          ) : pending <= 0 && q.totalCents > 0 ? (
            <Notice kind="ok">Pagada completa. Recibo {q.receipt}.</Notice>
          ) : (
            <p className="form__lead">
              {q.status === "cancelled" ? "Cotización cancelada: no se registran más pagos." : "Los pagos se registran cuando el cliente ya aprobó la cotización."}
            </p>
          )}
        </Panel>
      </div>

      {doc && (
        <DocSheet title={doc === "receipt" ? `Recibo ${q.receipt}` : `Cotización ${q.code}`} onClose={() => setDoc(null)}>
          <QuoteDocument quote={q} kind={doc} />
        </DocSheet>
      )}
    </div>
  );
}

// ---------- Listas ----------
function QuoteRows({ rows, onOpen, show }: { rows: QuoteSummary[]; onOpen: (id: number) => void; show: "status" | "receipt" }) {
  return (
    <ul className="quotes">
      {rows.map((q) => (
        <li key={q.id}>
          <button type="button" onClick={() => onOpen(q.id)}>
            <span className="quotes__main">
              <strong>{q.customerName}</strong>
              <small>
                {show === "receipt" ? `${q.receipt}, pagada el ${q.paidAt ? when(q.paidAt) : ""}. ` : ""}
                {q.code}
                {q.occasion ? `, ${q.occasion}` : ""}
              </small>
              <small>{q.eventAt ? `${when(q.eventAt)}, ${q.guests} invitados` : "Sin fecha todavía"}</small>
            </span>
            <span className="quotes__side">
              <strong>{ref(q.totalCents)}</strong>
              {show === "status" && <Badge tone={TONE[q.status]}>{QUOTE_LABEL[q.status]}</Badge>}
              {show === "status" && q.status !== "cancelled" && q.status !== "draft" && <small>{payState(q)}</small>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Agenda({ rows, onOpen }: { rows: QuoteSummary[]; onOpen: (id: number) => void }) {
  const upcoming = rows.filter((q) => q.status === "scheduled" && q.eventAt && q.eventAt + q.durationMinutes * 60_000 > Date.now()).sort((a, b) => a.eventAt! - b.eventAt!);
  const toSchedule = rows.filter((q) => q.status === "approved");
  const days = [...new Set(upcoming.map((q) => dayName(q.eventAt!)))];
  return (
    <>
      {toSchedule.length > 0 && (
        <Panel title="Aprobadas, falta agendarlas">
          <QuoteRows rows={toSchedule} onOpen={onOpen} show="status" />
        </Panel>
      )}
      <Panel title="Próximas fiestas">
        {upcoming.length === 0 ? (
          <p className="empty">No hay fiestas agendadas. Cuando agendes una cotización aprobada, aparecerá aquí.</p>
        ) : (
          days.map((day) => (
            <div className="agenda" key={day}>
              <h3>{day}</h3>
              <ul className="rows">
                {upcoming
                  .filter((q) => dayName(q.eventAt!) === day)
                  .map((q) => (
                    <li key={q.id}>
                      <button type="button" className="rows__open" onClick={() => onOpen(q.id)}>
                        <span className="rows__main">
                          <strong>
                            {clock(q.eventAt!)} a {clock(q.eventAt! + q.durationMinutes * 60_000)}, {q.customerName}
                          </strong>
                          <small>
                            {q.occasion ? `${q.occasion}, ` : ""}
                            {q.guests} invitados, {q.code}
                          </small>
                        </span>
                        <span className="rows__side">{q.paidCents >= q.totalCents ? "Pagada" : `Falta ${ref(q.totalCents - q.paidCents)}`}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}

function PackageRow({ pack }: { pack?: PartyPackage }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: pack?.name ?? "",
    description: pack?.description ?? "",
    price: pack ? money(pack.priceCents) : "",
    durationMinutes: pack?.durationMinutes ?? 120,
    guests: String(pack?.guests ?? 10),
    active: pack?.active ?? true,
  });
  const save = trpc.office.packageSave.useMutation({
    onSuccess: () => {
      if (!pack) setForm({ name: "", description: "", price: "", durationMinutes: 120, guests: "10", active: true });
      return utils.office.packages.invalidate();
    },
  });
  const priceCents = parseMoney(form.price);
  return (
    <form
      className="form pack-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (priceCents !== null) save.mutate({ id: pack?.id, name: form.name, description: form.description, priceCents, durationMinutes: form.durationMinutes, guests: Math.floor(Number(form.guests)) || 1, active: form.active });
      }}
    >
      <div className="form__pair">
        <Field label="Nombre del paquete">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Cachorro, Pantera…" required />
        </Field>
        <Field label="Precio en REF">
          <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} inputMode="decimal" required />
        </Field>
      </div>
      <div className="form__pair">
        <Field label="Duración">
          <select value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))}>
            {[...new Set([...DURATIONS, form.durationMinutes])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {duration(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invitados incluidos">
          <input value={form.guests} onChange={(e) => setForm((f) => ({ ...f, guests: e.target.value }))} inputMode="numeric" required />
        </Field>
      </div>
      <Field label="Qué trae (opcional)">
        <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="2 horas de PC y consolas, pizza, refrescos…" />
      </Field>
      {pack && (
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Disponible para cotizaciones nuevas
        </label>
      )}
      <Notice>{save.error?.message ?? (form.price && priceCents === null ? "Escribe el precio así: 120 o 120,50." : null)}</Notice>
      {save.isSuccess && pack && <Notice kind="ok">Paquete guardado.</Notice>}
      <button className="btn btn--small" type="submit" disabled={save.isPending}>
        {pack ? "Guardar paquete" : "Agregar paquete"}
      </button>
    </form>
  );
}

function Packages() {
  const packages = trpc.office.packages.useQuery();
  return (
    <>
      <Panel title="Paquete nuevo">
        <p className="panel__lead">Los paquetes son el punto de partida de una cotización. Cambiar un paquete no altera las cotizaciones ya hechas.</p>
        <PackageRow />
      </Panel>
      {(packages.data ?? []).map((p) => (
        <Panel key={p.id} title={`${p.name}${p.active ? "" : " (oculto)"}`}>
          <PackageRow pack={p} />
        </Panel>
      ))}
    </>
  );
}

// ---------- Pantalla ----------
type View = "lista" | "agenda" | "pagadas" | "paquetes";
const FILTERS: (QuoteStatus | "all")[] = ["all", "draft", "sent", "approved", "scheduled", "done", "cancelled"];

export default function Parties() {
  const quotes = trpc.office.quotes.useQuery(undefined, { refetchInterval: 20_000 });
  const [view, setView] = useState<View>("lista");
  const [filter, setFilter] = useState<QuoteStatus | "all">("all");
  const [open, setOpen] = useState<number | "new" | null>(null);
  const rows = quotes.data ?? [];

  if (open === "new") return <QuoteEditor onDone={(id) => setOpen(id)} onCancel={() => setOpen(null)} />;
  if (open !== null) return <QuoteView id={open} onBack={() => setOpen(null)} />;

  const shown = filter === "all" ? rows.filter((q) => q.status !== "cancelled") : rows.filter((q) => q.status === filter);
  const paid = rows.filter((q) => q.receipt).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  const views: { id: View; label: string }[] = [
    { id: "lista", label: "Cotizaciones" },
    { id: "agenda", label: "Agenda" },
    { id: "pagadas", label: "Pagadas y recibos" },
    { id: "paquetes", label: "Paquetes" },
  ];

  return (
    <div className="parties">
      <div className="parties__bar">
        <div className="tabs" role="tablist" aria-label="Secciones de fiestas">
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? "is-active" : undefined} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button className="btn" type="button" onClick={() => setOpen("new")}>
          Nueva cotización
        </button>
      </div>
      {quotes.error && <Notice>{quotes.error.message}</Notice>}

      {view === "lista" && (
        <Panel>
          <div className="filters" role="group" aria-label="Filtrar por estado">
            {FILTERS.map((f) => {
              const n = f === "all" ? rows.filter((q) => q.status !== "cancelled").length : rows.filter((q) => q.status === f).length;
              return (
                <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? "is-active" : undefined} onClick={() => setFilter(f)}>
                  {f === "all" ? "Todas" : QUOTE_LABEL[f]} <span>{n}</span>
                </button>
              );
            })}
          </div>
          {!quotes.data ? (
            <p className="empty">Cargando…</p>
          ) : shown.length === 0 ? (
            <p className="empty">{rows.length === 0 ? "Todavía no hay cotizaciones. Crea la primera con el botón Nueva cotización." : "No hay cotizaciones en este estado."}</p>
          ) : (
            <QuoteRows rows={shown} onOpen={setOpen} show="status" />
          )}
        </Panel>
      )}
      {view === "agenda" && <Agenda rows={rows} onOpen={setOpen} />}
      {view === "pagadas" && (
        <Panel title="Fiestas pagadas">
          {paid.length === 0 ? (
            <p className="empty">Cuando una cotización quede pagada completa, aquí aparece con su número de recibo.</p>
          ) : (
            <>
              <p className="panel__lead">
                {paid.length} {paid.length === 1 ? "fiesta pagada" : "fiestas pagadas"}, {ref(paid.reduce((sum, q) => sum + q.totalCents, 0))} en total. Toca una para ver o imprimir su recibo.
              </p>
              <QuoteRows rows={paid} onOpen={setOpen} show="receipt" />
            </>
          )}
        </Panel>
      )}
      {view === "paquetes" && <Packages />}
    </div>
  );
}
