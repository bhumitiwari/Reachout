import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUpRight, AtSign, Check, ChevronDown, CircleHelp, Clock3, FileText,
  Inbox, LayoutDashboard, LogOut, Mail, Menu, Plus, Search, Send, Settings, ShieldCheck,
  Users, X, Trash2, Eye, Paperclip, RefreshCw
} from "lucide-react";
import { api, json } from "./api";

type User = { id: string; name: string; email: string };
type Template = { id: string; name: string; category: string; subject: string; body: string };
type Contact = { id: string; name: string; email: string; organization?: string; role?: string; notes?: string };
type Smtp = { id: string; name: string; senderName: string; senderEmail: string; host: string; port: number; securityMode: "TLS" | "STARTTLS"; username: string; isDefault: boolean };
type HistoryItem = { id: string; recipientName?: string; recipientEmail: string; organization?: string; subject: string; body: string; status: string; errorMessage?: string; attachmentName?: string; sentAt?: string; createdAt: string };
type Section = "Overview" | "Compose" | "Templates" | "Contacts" | "Email accounts" | "Email history" | "Settings";
const starterSubject = "Exploring opportunities at {{organization}}";
const starterBody = `Hi {{name}},\n\nI hope you're doing well.\n\nI'm reaching out to express my interest in opportunities at {{organization}}. {{personal_note}}\n\nI'd love to connect and explore whether there might be an opportunity to contribute to your team.\n\nThank you for your time.\n\nBest regards,\n{{your_name}}\n{{portfolio_url}}`;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [section, setSection] = useState<Section>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Smtp[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState({ templates: 0, contacts: 0, accounts: 0, sentThisWeek: 0 });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [templateForm, setTemplateForm] = useState<Partial<Template> | null>(null);
  const [contactForm, setContactForm] = useState<Partial<Contact> | null>(null);
  const [smtpForm, setSmtpForm] = useState({ name: "Personal email", senderName: "", senderEmail: "", host: "smtp.gmail.com", port: "587", securityMode: "STARTTLS", username: "", password: "", isDefault: true });
  const [compose, setCompose] = useState({
    smtpAccountId: "", templateId: "", recipientName: "", recipientEmail: "", organization: "", role: "", position: "",
    personalNote: "", yourName: "", yourEmail: "", portfolioUrl: "", linkedinUrl: "", subject: starterSubject, body: starterBody
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preview, setPreview] = useState<{ subject: string; body: string; unresolvedPlaceholders: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [duplicatePayload, setDuplicatePayload] = useState<FormData | null>(null);

  useEffect(() => { api<{ user: User }>("/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) void loadAll(); }, [user]);
  useEffect(() => {
    const handler = (event: Event) => setSection((event as CustomEvent<Section>).detail);
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  }, []);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(t); } }, [notice]);

  async function loadAll() {
    setLoading(true);
    try {
      const [t, c, a, h, d] = await Promise.all([
        api<Template[]>("/templates"), api<Contact[]>("/contacts"), api<Smtp[]>("/smtp"),
        api<HistoryItem[]>("/emails/history"), api<{ stats: typeof stats; recent: HistoryItem[] }>("/dashboard")
      ]);
      setTemplates(t); setContacts(c); setAccounts(a); setHistory(h); setStats(d.stats);
      if (!compose.smtpAccountId && a.length) setCompose((old) => ({ ...old, smtpAccountId: (a.find((x) => x.isDefault) || a[0]).id }));
    } catch (e) { setNotice({ type: "error", text: errText(e) }); }
    finally { setLoading(false); }
  }
  async function authSubmit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const data = await api<{ user: User }>(`/auth/${authMode}`, json("POST", authForm));
      setUser(data.user); setNotice({ type: "ok", text: `Welcome${data.user.name ? `, ${data.user.name}` : ""}!` });
    } catch (e) { setNotice({ type: "error", text: errText(e) }); }
    finally { setBusy(false); }
  }
  async function signOut() { await api("/auth/logout", json("POST")).catch(() => {}); setUser(null); setSection("Overview"); }
  async function saveTemplate(e: FormEvent) {
    e.preventDefault(); if (!templateForm) return; setBusy(true);
    try {
      if (templateForm.id) await api(`/templates/${templateForm.id}`, json("PUT", templateForm));
      else await api("/templates", json("POST", templateForm));
      setTemplateForm(null); await loadAll(); setNotice({ type: "ok", text: "Template saved." });
    } catch (e) { setNotice({ type: "error", text: errText(e) }); } finally { setBusy(false); }
  }
  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    try { await api(`/templates/${id}`, json("DELETE")); await loadAll(); setNotice({ type: "ok", text: "Template deleted." }); }
    catch (e) { setNotice({ type: "error", text: errText(e) }); }
  }
  async function saveContact(e: FormEvent) {
    e.preventDefault(); if (!contactForm) return; setBusy(true);
    try {
      if (contactForm.id) await api(`/contacts/${contactForm.id}`, json("PUT", contactForm));
      else await api("/contacts", json("POST", contactForm));
      setContactForm(null); await loadAll(); setNotice({ type: "ok", text: "Contact saved." });
    } catch (e) { setNotice({ type: "error", text: errText(e) }); } finally { setBusy(false); }
  }
  async function deleteContact(id: string) {
    if (!confirm("Delete this contact?")) return;
    try { await api(`/contacts/${id}`, json("DELETE")); await loadAll(); setNotice({ type: "ok", text: "Contact deleted." }); }
    catch (e) { setNotice({ type: "error", text: errText(e) }); }
  }
  async function addSmtp(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api("/smtp", json("POST", { ...smtpForm, port: Number(smtpForm.port) }));
      setSmtpForm((f) => ({ ...f, password: "" })); await loadAll();
      setNotice({ type: "ok", text: "SMTP account saved. Test the connection before sending." });
    } catch (e) { setNotice({ type: "error", text: errText(e) }); } finally { setBusy(false); }
  }
  async function testSmtp(id: string) {
    setBusy(true);
    try { const d = await api<{ message: string }>(`/smtp/${id}/test`, json("POST", {})); setNotice({ type: "ok", text: d.message }); }
    catch (e) { setNotice({ type: "error", text: errText(e) }); } finally { setBusy(false); }
  }
  async function testEmail(id: string) {
    if (!testTo.trim()) return setNotice({ type: "error", text: "Enter a destination email for the test." });
    setBusy(true);
    try { const d = await api<{ message: string }>(`/smtp/${id}/test-email`, json("POST", { to: testTo })); setNotice({ type: "ok", text: d.message }); }
    catch (e) { setNotice({ type: "error", text: errText(e) }); } finally { setBusy(false); }
  }
  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setCompose((c) => ({ ...c, templateId: id, subject: t.subject, body: t.body }));
    setPreview(null);
  }
  function useContact(id: string) {
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    setCompose((old) => ({ ...old, recipientName: c.name, recipientEmail: c.email, organization: c.organization || "", role: c.role || "" }));
  }
  function composePayload() {
    return { ...compose, contactId: contacts.find((c) => c.email.toLowerCase() === compose.recipientEmail.toLowerCase())?.id || null };
  }
  async function previewEmail() {
    setBusy(true);
    try {
      const p = await api<typeof preview>("/emails/preview", json("POST", composePayload()));
      setPreview(p);
      if (p?.unresolvedPlaceholders.length) setNotice({ type: "error", text: `Fill these placeholders: ${p.unresolvedPlaceholders.join(", ")}` });
    } catch (e) { setNotice({ type: "error", text: errText(e) }); }
    finally { setBusy(false); }
  }
  async function sendEmail(confirmDuplicate = false) {
    if (!preview) {
      setNotice({ type: "error", text: "Preview the email before sending." }); return;
    }
    if (preview.unresolvedPlaceholders.length) {
      setNotice({ type: "error", text: `Resolve placeholders: ${preview.unresolvedPlaceholders.join(", ")}` }); return;
    }
    if (!confirm("Send this email to " + compose.recipientEmail + "?")) return;
    setBusy(true);
    const form = new FormData();
    form.append("payload", JSON.stringify(composePayload()));
    if (confirmDuplicate) form.append("confirmDuplicate", "true");
    attachments.forEach((file) => form.append("attachments", file));
    try {
      const result = await api<{ ok: boolean; message: string }>("/emails/send", { method: "POST", body: form });
      setNotice({ type: "ok", text: result.message }); setPreview(null); setAttachments([]); await loadAll();
    } catch (e) {
      const message = errText(e);
      if (message.includes("similar email")) {
        setNotice({ type: "error", text: `${message} Confirm the resend by pressing Send again.` });
        setDuplicatePayload(form);
      } else setNotice({ type: "error", text: message });
    } finally { setBusy(false); }
  }
  const filteredTemplates = useMemo(() => templates.filter((x) => `${x.name} ${x.category} ${x.subject}`.toLowerCase().includes(search.toLowerCase())), [templates, search]);
  const filteredContacts = useMemo(() => contacts.filter((x) => `${x.name} ${x.email} ${x.organization || ""}`.toLowerCase().includes(search.toLowerCase())), [contacts, search]);
  const filteredHistory = useMemo(() => history.filter((x) => `${x.recipientName || ""} ${x.recipientEmail} ${x.organization || ""} ${x.subject} ${x.status}`.toLowerCase().includes(search.toLowerCase())), [history, search]);

  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} onSubmit={authSubmit} busy={busy} notice={notice} />;

  const nav: { name: Section; icon: typeof LayoutDashboard; badge?: number }[] = [
    { name: "Overview", icon: LayoutDashboard }, { name: "Compose", icon: Send },
    { name: "Templates", icon: FileText, badge: templates.length }, { name: "Contacts", icon: Users, badge: contacts.length },
    { name: "Email accounts", icon: AtSign, badge: accounts.length }, { name: "Email history", icon: Inbox }
  ];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Send size={19} /></div><div><b>reachout</b><span>PERSONAL MAILER</span></div><button className="icon-btn mobile-close" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{nav.map((item) => <button key={item.name} className={`nav-item ${section === item.name ? "active" : ""}`} onClick={() => { setSection(item.name); setMobileNav(false); setSearch(""); }}>
        <item.icon size={18}/><span>{item.name}</span>{item.badge !== undefined && item.badge > 0 && <small>{item.badge}</small>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="privacy-note"><ShieldCheck size={17}/><div><b>Your accounts, your email</b><span>Send through your own SMTP provider.</span></div></div>
        <button className={`nav-item ${section === "Settings" ? "active" : ""}`} onClick={() => setSection("Settings")}><Settings size={18}/><span>Settings</span></button>
        <div className="profile-row"><div className="avatar">{initials(user.name)}</div><div className="profile-info"><b>{user.name}</b><span>{user.email}</span></div><button className="icon-btn" title="Log out" onClick={signOut}><LogOut size={17}/></button></div>
      </div>
    </aside>
    {mobileNav && <button className="scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-menu" onClick={() => setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumbs">Workspace <span>/</span> <b>{section}</b></div><div className="topbar-right"><span className="connection-dot"></span><span>Personal workspace</span><div className="avatar small">{initials(user.name)}</div></div></header>
      <div className="page-wrap">
        {notice && <div className={`notice ${notice.type}`}><span>{notice.text}</span>{notice.text.includes("Confirm the resend") && section === "Compose" ? <button className="btn secondary" onClick={() => sendEmail(true)} disabled={busy}>Confirm resend</button> : null}<button className="icon-btn" onClick={() => setNotice(null)}><X size={16}/></button></div>}
        {section === "Overview" && <Dashboard stats={stats} history={history.slice(0, 5)} setSection={setSection} user={user} />}
        {section === "Compose" && <ComposePage compose={compose} setCompose={(updater) => { setCompose(updater); setPreview(null); }} accounts={accounts} templates={templates} contacts={contacts} applyTemplate={applyTemplate} useContact={useContact} attachments={attachments} setAttachments={setAttachments} preview={preview} previewEmail={previewEmail} sendEmail={sendEmail} busy={busy} duplicatePayload={duplicatePayload} />}
        {section === "Templates" && <TemplatesPage items={filteredTemplates} search={search} setSearch={setSearch} onAdd={() => setTemplateForm({ name: "", category: "Internship", subject: starterSubject, body: starterBody })} onEdit={(t) => setTemplateForm(t)} onDelete={deleteTemplate} />}
        {section === "Contacts" && <ContactsPage items={filteredContacts} search={search} setSearch={setSearch} onAdd={() => setContactForm({ name: "", email: "", organization: "", role: "", notes: "" })} onEdit={setContactForm} onDelete={deleteContact} onCompose={(c) => { useContact(c.id); setSection("Compose"); }} />}
        {section === "Email accounts" && <SmtpPage accounts={accounts} form={smtpForm} setForm={setSmtpForm} onSubmit={addSmtp} onTest={testSmtp} onDelete={async (id) => { if (!confirm("Remove this SMTP account?")) return; try { await api(`/smtp/${id}`, json("DELETE")); await loadAll(); } catch (e) { setNotice({ type: "error", text: errText(e) }); } }} testTo={testTo} setTestTo={setTestTo} onTestEmail={testEmail} busy={busy} />}
        {section === "Email history" && <HistoryPage items={filteredHistory} search={search} setSearch={setSearch} />}
        {section === "Settings" && <SettingsPage user={user} onLogout={signOut} />}
      </div>
    </main>
    {templateForm && <Modal title={templateForm.id ? "Edit template" : "Create template"} onClose={() => setTemplateForm(null)}>
      <form className="form-stack" onSubmit={saveTemplate}>
        <Field label="Template name"><input required value={templateForm.name || ""} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="Founder outreach" /></Field>
        <Field label="Category"><input value={templateForm.category || ""} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })} placeholder="Internship, Cold outreach..." /></Field>
        <Field label="Subject"><input required value={templateForm.subject || ""} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} /></Field>
        <Field label="Email body"><textarea required rows={9} value={templateForm.body || ""} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} /></Field>
        <div className="hint">Variables: {"{{name}}"}, {"{{organization}}"}, {"{{role}}"}, {"{{position}}"}, {"{{personal_note}}"}, {"{{your_name}}"}, {"{{your_email}}"}, {"{{portfolio_url}}"}, {"{{linkedin_url}}"}</div>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setTemplateForm(null)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save template"}</button></div>
      </form>
    </Modal>}
    {contactForm && <Modal title={contactForm.id ? "Edit contact" : "Add contact"} onClose={() => setContactForm(null)}>
      <form className="form-stack" onSubmit={saveContact}>
        <Field label="Full name"><input required value={contactForm.name || ""} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} /></Field>
        <Field label="Email address"><input required type="email" value={contactForm.email || ""} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} /></Field>
        <div className="form-grid"><Field label="Organization"><input value={contactForm.organization || ""} onChange={(e) => setContactForm({ ...contactForm, organization: e.target.value })} /></Field><Field label="Role"><input value={contactForm.role || ""} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })} /></Field></div>
        <Field label="Notes"><textarea rows={3} value={contactForm.notes || ""} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })} /></Field>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setContactForm(null)}>Cancel</button><button className="btn primary" disabled={busy}>Save contact</button></div>
      </form>
    </Modal>}
  </div>;
}

function AuthScreen({ mode, setMode, form, setForm, onSubmit, busy, notice }: any) {
  return <div className="auth-shell"><div className="auth-decoration"><div className="brand light"><div className="brand-mark"><Send size={19}/></div><div><b>reachout</b><span>PERSONAL MAILER</span></div></div><div className="auth-pitch"><div className="eyebrow light-eyebrow">YOUR OUTREACH, ORGANIZED</div><h1>Make every<br/>introduction <em>count.</em></h1><p>Personalized outreach, reusable templates, and your own email accounts — all in one calm workspace.</p><div className="auth-feature"><div className="feature-icon"><FileText size={18}/></div><div><b>Templates that sound like you</b><span>Reuse your best writing, personalize every send.</span></div></div><div className="auth-feature"><div className="feature-icon"><ShieldCheck size={18}/></div><div><b>Your account. Your SMTP.</b><span>Connect a supported email provider you control.</span></div></div></div><div className="auth-footer">A focused workspace for thoughtful outreach.</div></div>
    <div className="auth-panel"><form className="auth-card" onSubmit={onSubmit}><div className="mobile-auth-brand brand"><div className="brand-mark"><Send size={18}/></div><div><b>reachout</b><span>PERSONAL MAILER</span></div></div><div className="eyebrow">WELCOME TO REACHOUT</div><h2>{mode === "login" ? "Welcome back" : "Create your workspace"}</h2><p className="muted">{mode === "login" ? "Sign in to pick up where you left off." : "Set up your private outreach workspace."}</p>
      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}
      {mode === "register" && <Field label="Full name"><input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name"/></Field>}
      <Field label="Email address"><input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com"/></Field>
      <Field label="Password"><input required type="password" minLength={mode === "register" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={mode === "register" ? "At least 12 characters" : "Your password"}/></Field>
      {mode === "register" && <p className="hint">Use at least 12 characters. This starter does not yet include email verification or password recovery.</p>}
      <button className="btn primary full-btn" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <ArrowUpRight size={17}/></button>
      <div className="auth-switch">{mode === "login" ? "New to Reachout?" : "Already have an account?"} <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create account" : "Sign in"}</button></div>
      <div className="auth-security"><ShieldCheck size={15}/> Your SMTP credentials are encrypted before storage.</div>
    </form></div></div>;
}

function Dashboard({ stats, history, setSection, user }: any) {
  return <><PageHeading eyebrow="YOUR WORKSPACE" title={`Good to see you, ${user.name.split(" ")[0]}.`} subtitle="A clear view of your outreach and what to do next." action={<button className="btn primary" onClick={() => setSection("Compose")}><Plus size={17}/> Compose email</button>}/>
    <div className="stats-grid"><Stat icon={Send} label="Sent this week" value={stats.sentThisWeek} detail="Across your accounts" tone="blue"/><Stat icon={FileText} label="Email templates" value={stats.templates} detail="Ready to personalize" tone="violet"/><Stat icon={Users} label="Saved contacts" value={stats.contacts} detail="People in your network" tone="green"/><Stat icon={AtSign} label="Email accounts" value={stats.accounts} detail="Your SMTP connections" tone="amber"/></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h3>Recent activity</h3><p>Your latest outreach, all in one place.</p></div><button className="text-btn" onClick={() => setSection("Email history")}>View history <ArrowUpRight size={15}/></button></div>
      {history.length ? <div className="activity-list">{history.map((item: HistoryItem) => <div className="activity-row" key={item.id}><div className="activity-avatar">{initials(item.recipientName || item.recipientEmail)}</div><div className="activity-main"><b>{item.recipientName || item.recipientEmail}</b><span>{item.organization || item.recipientEmail} · {item.subject}</span></div><StatusPill status={item.status}/></div>)}</div> : <Empty icon={Inbox} title="No emails yet" text="Your outreach history will show up here." action={<button className="btn secondary" onClick={() => setSection("Compose")}>Write your first email</button>}/>}</section>
      <section className="panel quick-panel"><div className="panel-heading"><div><h3>Get started</h3><p>Your next step, made simple.</p></div><div className="soft-icon"><Activity size={18}/></div></div>
        <QuickStep n="01" title="Connect your email" text="Add an SMTP account you control." done={stats.accounts > 0} onClick={() => setSection("Email accounts")}/>
        <QuickStep n="02" title="Create a template" text="Write once, personalize each time." done={stats.templates > 0} onClick={() => setSection("Templates")}/>
        <QuickStep n="03" title="Send your first email" text="Preview it before it goes out." done={stats.sentThisWeek > 0} onClick={() => setSection("Compose")}/>
        <div className="tip-box"><CircleHelp size={17}/><span><b>A thoughtful note goes further.</b> Customize each email for the person you're contacting.</span></div>
      </section></div>
  </>;
}
function QuickStep({ n, title, text, done, onClick }: any) { return <button className="quick-step" onClick={onClick}><span className={`step-num ${done ? "done" : ""}`}>{done ? <Check size={15}/> : n}</span><span className="step-copy"><b>{title}</b><small>{text}</small></span><ArrowUpRight size={16} className="step-arrow"/></button>; }
function Stat({ icon: Icon, label, value, detail, tone }: any) { return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>; }

function ComposePage({ compose, setCompose, accounts, templates, contacts, applyTemplate, useContact, attachments, setAttachments, preview, previewEmail, sendEmail, busy }: any) {
  const [contactPick, setContactPick] = useState("");
  return <><PageHeading eyebrow="MAKE AN INTRODUCTION" title="Compose an email" subtitle="Start with a template, make it personal, then preview before sending."/>
    {accounts.length === 0 && <div className="callout warning"><AtSign size={18}/><div><b>Connect an email account first</b><span>Add an SMTP account before you try to send.</span></div><button className="btn secondary" onClick={() => window.dispatchEvent(new CustomEvent("navigate", { detail: "Email accounts" }))}>Set up SMTP</button></div>}
    <div className="compose-layout"><div className="panel compose-form-panel"><div className="panel-heading"><div><h3>Message details</h3><p>Fields marked with * are required.</p></div><span className="step-chip">STEP 01</span></div>
      <div className="form-stack">
        <div className="form-grid"><Field label="Email account *"><select required value={compose.smtpAccountId} onChange={(e) => setCompose((c: any) => ({ ...c, smtpAccountId: e.target.value }))}><option value="">Choose account</option>{accounts.map((a: Smtp) => <option key={a.id} value={a.id}>{a.name} · {a.senderEmail}</option>)}</select></Field><Field label="Email template"><select value={compose.templateId} onChange={(e) => applyTemplate(e.target.value)}><option value="">Write from scratch</option>{templates.map((t: Template) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
        {contacts.length > 0 && <Field label="Use a saved contact"><select value={contactPick} onChange={(e) => { setContactPick(e.target.value); useContact(e.target.value); }}><option value="">Choose a contact to fill details…</option>{contacts.map((c: Contact) => <option key={c.id} value={c.id}>{c.name} — {c.organization || c.email}</option>)}</select></Field>}
        <div className="divider-label">RECIPIENT</div>
        <div className="form-grid"><Field label="Full name *"><input value={compose.recipientName} onChange={(e) => setCompose((c: any) => ({ ...c, recipientName: e.target.value }))} placeholder="Rahul Sharma"/></Field><Field label="Email address *"><input type="email" required value={compose.recipientEmail} onChange={(e) => setCompose((c: any) => ({ ...c, recipientEmail: e.target.value }))} placeholder="rahul@company.com"/></Field></div>
        <div className="form-grid"><Field label="Organization"><input value={compose.organization} onChange={(e) => setCompose((c: any) => ({ ...c, organization: e.target.value }))} placeholder="Company or startup"/></Field><Field label="Recipient role"><input value={compose.role} onChange={(e) => setCompose((c: any) => ({ ...c, role: e.target.value }))} placeholder="Founder, recruiter…"/></Field></div>
        <div className="form-grid"><Field label="Position / opportunity"><input value={compose.position} onChange={(e) => setCompose((c: any) => ({ ...c, position: e.target.value }))} placeholder="Software Engineering Intern"/></Field><Field label="Personal note"><input value={compose.personalNote} onChange={(e) => setCompose((c: any) => ({ ...c, personalNote: e.target.value }))} placeholder="Why you're reaching out"/></Field></div>
        <div className="divider-label">YOUR DETAILS</div>
        <div className="form-grid"><Field label="Your name"><input value={compose.yourName} onChange={(e) => setCompose((c: any) => ({ ...c, yourName: e.target.value }))} placeholder="Your full name"/></Field><Field label="Your email"><input type="email" value={compose.yourEmail} onChange={(e) => setCompose((c: any) => ({ ...c, yourEmail: e.target.value }))} placeholder="you@example.com"/></Field></div>
        <div className="form-grid"><Field label="Portfolio URL"><input value={compose.portfolioUrl} onChange={(e) => setCompose((c: any) => ({ ...c, portfolioUrl: e.target.value }))} placeholder="https://…"/></Field><Field label="LinkedIn URL"><input value={compose.linkedinUrl} onChange={(e) => setCompose((c: any) => ({ ...c, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/…"/></Field></div>
        <div className="divider-label">EMAIL CONTENT</div>
        <Field label="Subject *"><input required value={compose.subject} onChange={(e) => setCompose((c: any) => ({ ...c, subject: e.target.value }))}/></Field>
        <Field label="Message body *"><textarea required rows={11} value={compose.body} onChange={(e) => setCompose((c: any) => ({ ...c, body: e.target.value }))}/></Field>
        <div className="hint">Use {"{{name}}"}, {"{{organization}}"}, {"{{position}}"}, {"{{personal_note}}"}, {"{{your_name}}"}, {"{{portfolio_url}}"} and other template variables.</div>
        <Field label="Attachments (PDF, TXT, DOC, DOCX; max 8 MB each)"><label className="upload-box"><Paperclip size={18}/><span>{attachments.length ? attachments.map((f: File) => f.name).join(", ") : "Choose resume or supporting files"}</span><input type="file" multiple accept=".pdf,.txt,.doc,.docx" onChange={(e) => setAttachments(Array.from(e.target.files || []))}/></label></Field>
        <div className="form-actions"><button className="btn secondary" onClick={previewEmail} disabled={busy}><Eye size={16}/> Preview email</button><button className="btn primary" onClick={sendEmail} disabled={busy || !accounts.length}><Send size={16}/>{busy ? "Working…" : "Send email"}</button></div>
      </div>
    </div>
    <div className="preview-column"><div className="panel preview-panel"><div className="panel-heading"><div><h3>Live preview</h3><p>Check every detail before sending.</p></div><div className="preview-indicator"><span/> PREVIEW</div></div>
      {preview ? <div className="email-preview"><div className="preview-field"><span>TO</span><b>{compose.recipientName || "Recipient"} &lt;{compose.recipientEmail || "recipient@example.com"}&gt;</b></div><div className="preview-field"><span>SUBJECT</span><b>{preview.subject}</b></div>{preview.unresolvedPlaceholders.length > 0 && <div className="callout warning small-callout">Unfilled: {preview.unresolvedPlaceholders.join(", ")}</div>}<div className="preview-body">{preview.body}</div></div> : <Empty icon={Eye} title="Your preview will appear here" text="Fill in the recipient and message, then select Preview email."/>}
    </div><div className="mini-tip"><ShieldCheck size={18}/><div><b>Review before sending</b><p>Messages are sent through your selected SMTP account. The server accepting a message doesn't guarantee final delivery.</p></div></div></div></div>
  </>;
}

function TemplatesPage({ items, search, setSearch, onAdd, onEdit, onDelete }: any) {
  return <><PageHeading eyebrow="YOUR WORDS, REUSABLE" title="Email templates" subtitle="Build a small library of messages you can personalize for each person." action={<button className="btn primary" onClick={onAdd}><Plus size={17}/> New template</button>}/><SearchBox value={search} onChange={setSearch} placeholder="Search templates…"/>
    {items.length ? <div className="template-grid">{items.map((t: Template) => <div className="template-card" key={t.id}><div className="template-card-top"><div className="template-icon"><FileText size={19}/></div><span className="category-pill">{t.category || "General"}</span></div><h3>{t.name}</h3><div className="template-subject">{t.subject}</div><p>{t.body.slice(0, 145)}{t.body.length > 145 ? "…" : ""}</p><div className="template-card-footer"><span><span className="tiny-dot"/> Ready to personalize</span><div><button className="icon-btn" title="Edit" onClick={() => onEdit(t)}><Settings size={16}/></button><button className="icon-btn danger-icon" title="Delete" onClick={() => onDelete(t.id)}><Trash2 size={16}/></button></div></div></div>)}</div> : <Empty icon={FileText} title="No templates found" text="Create a reusable email template to get started." action={<button className="btn primary" onClick={onAdd}><Plus size={16}/> Create template</button>}/>}
  </>;
}
function ContactsPage({ items, search, setSearch, onAdd, onEdit, onDelete, onCompose }: any) {
  return <><PageHeading eyebrow="PEOPLE YOU'RE REACHING OUT TO" title="Contacts" subtitle="Keep the details you need in one private place." action={<button className="btn primary" onClick={onAdd}><Plus size={17}/> Add contact</button>}/><SearchBox value={search} onChange={setSearch} placeholder="Search name, email, organization…"/>
    <div className="panel table-panel">{items.length ? <div className="table-wrap"><table><thead><tr><th>CONTACT</th><th>ORGANIZATION</th><th>ROLE</th><th>ACTIONS</th></tr></thead><tbody>{items.map((c: Contact) => <tr key={c.id}><td><div className="table-person"><div className="avatar">{initials(c.name)}</div><div><b>{c.name}</b><span>{c.email}</span></div></div></td><td>{c.organization || "—"}</td><td>{c.role || "—"}</td><td><div className="table-actions"><button className="icon-btn" title="Compose email" onClick={() => onCompose(c)}><Mail size={16}/></button><button className="icon-btn" title="Edit contact" onClick={() => onEdit(c)}><Settings size={16}/></button><button className="icon-btn danger-icon" title="Delete contact" onClick={() => onDelete(c.id)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <Empty icon={Users} title="Your contact list starts here" text="Save founders, recruiters, hiring managers, and other people you'd like to contact." action={<button className="btn primary" onClick={onAdd}><Plus size={16}/> Add contact</button>}/>}</div>
  </>;
}
function SmtpPage({ accounts, form, setForm, onSubmit, onTest, onDelete, testTo, setTestTo, onTestEmail, busy }: any) {
  const [provider, setProvider] = useState("Gmail");
  const [showAdvanced, setShowAdvanced] = useState(false);
  function chooseProvider(value: string) {
    setProvider(value);
    if (value === "Gmail") setForm({ ...form, host: "smtp.gmail.com", port: "587", securityMode: "STARTTLS" });
    else if (value === "Outlook") setForm({ ...form, host: "smtp-mail.outlook.com", port: "587", securityMode: "STARTTLS" });
    else setShowAdvanced(true);
  }
  return <><PageHeading eyebrow="SEND FROM YOUR OWN EMAIL" title="Connect your email" subtitle="One quick setup, then you can send messages from inside the app."/><div className="smtp-layout"><div className="panel smtp-form-panel"><div className="panel-heading"><div><h3>Add your email account</h3><p>Usually takes about two minutes.</p></div><div className="soft-icon"><AtSign size={18}/></div></div>
      <form className="form-stack" onSubmit={onSubmit}>
        <Field label="Email provider"><select value={provider} onChange={(e) => chooseProvider(e.target.value)}><option>Gmail</option><option>Outlook</option><option>Custom email provider</option></select></Field>
        <Field label="Your email address"><input required type="email" value={form.senderEmail} onChange={(e) => setForm({ ...form, senderEmail: e.target.value, username: e.target.value })} placeholder="you@gmail.com"/></Field>
        <Field label={provider === "Gmail" ? "Gmail App Password" : "Email password or app password"}><input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Paste your app password"/></Field>
        <Field label="Name recipients will see"><input required value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} placeholder="Your name"/></Field>
        {provider === "Gmail" && <div className="security-note"><ShieldCheck size={17}/><span><b>Using Gmail?</b> Create an App Password in your Google Account. Do not use your regular Gmail password. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Get an App Password</a>. Two-step verification must be enabled.</span></div>}
        {provider === "Outlook" && <div className="security-note"><ShieldCheck size={17}/><span>Use your provider-approved SMTP password or app password. Some work and school accounts block SMTP authentication.</span></div>}
        <button type="button" className="text-btn" onClick={() => setShowAdvanced((v: boolean) => !v)}>{showAdvanced ? "Hide advanced settings" : "Advanced settings (optional)"} <ChevronDown size={14}/></button>
        {showAdvanced && <div className="advanced-smtp-fields"><Field label="Account label"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Personal email"/></Field><Field label="SMTP server"><input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com"/></Field><div className="form-grid"><Field label="Port"><input required type="number" min="1" max="65535" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })}/></Field><Field label="Security"><select value={form.securityMode} onChange={(e) => setForm({ ...form, securityMode: e.target.value })}><option value="STARTTLS">STARTTLS (587)</option><option value="TLS">TLS (465)</option></select></Field></div><Field label="SMTP username"><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Usually your email address"/></Field></div>}
        <label className="checkbox-row"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}/><span>Use this account by default</span></label>
        <button className="btn primary full-btn" disabled={busy}>{busy ? "Connecting…" : "Save email account"} <ArrowUpRight size={17}/></button>
      </form>
    </div><div className="smtp-side"><div className="panel"><div className="panel-heading"><div><h3>Connected email accounts</h3><p>{accounts.length} account{accounts.length === 1 ? "" : "s"} saved</p></div></div>
      {accounts.length ? <div className="connected-list">{accounts.map((a: Smtp) => <div className="connected-card" key={a.id}><div className="provider-icon"><AtSign size={18}/></div><div className="connected-info"><b>{a.name} {a.isDefault && <span className="default-badge">DEFAULT</span>}</b><span>{a.senderEmail}</span><small>{a.host}:{a.port} · {a.securityMode}</small><div className="connected-actions"><button className="text-btn" onClick={() => onTest(a.id)} disabled={busy}><RefreshCw size={14}/> Test connection</button><button className="text-btn danger-text" onClick={() => onDelete(a.id)}><Trash2 size={14}/> Remove</button></div></div></div>)}</div> : <div className="empty-compact"><AtSign size={23}/><b>No email connected yet</b><span>Add your email above. You only need to do this once.</span></div>}
      {accounts.length > 0 && <div className="test-email-box"><label>Check that it works</label><div className="inline-input"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to this address"/><button className="btn secondary" onClick={() => onTestEmail((accounts.find((a: Smtp) => a.isDefault) || accounts[0]).id)} disabled={busy}>Send test</button></div><small>Try your own email address first.</small></div>}
    </div><div className="provider-help"><div className="help-title"><CircleHelp size={17}/> Before you start</div><p>For Gmail, use an App Password instead of your usual password. Your email provider may need to allow SMTP access. If the test fails, check the password and provider settings.</p></div></div></div>
  </>;
}
function HistoryPage({ items, search, setSearch }: any) {
  return <><PageHeading eyebrow="YOUR OUTREACH, RECORDED" title="Email history" subtitle="Review messages submitted through your SMTP accounts."/><SearchBox value={search} onChange={setSearch} placeholder="Search recipient, company, subject…"/><div className="panel table-panel">{items.length ? <div className="table-wrap"><table><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>{items.map((h: HistoryItem) => <tr key={h.id}><td><div className="table-person"><div className="avatar">{initials(h.recipientName || h.recipientEmail)}</div><div><b>{h.recipientName || "—"}</b><span>{h.recipientEmail}{h.organization ? ` · ${h.organization}` : ""}</span></div></div>{h.errorMessage && <small className="row-error">{h.errorMessage}</small>}</td><td><div className="subject-cell"><b>{h.subject}</b><span>{h.attachmentName ? `Attachment: ${h.attachmentName}` : "No attachments"}</span></div></td><td><StatusPill status={h.status}/></td><td><span className="date-cell">{new Date(h.sentAt || h.createdAt).toLocaleString()}</span></td></tr>)}</tbody></table></div> : <Empty icon={Inbox} title="No messages found" text="Emails you send will appear here, along with their submission status."/ >}</div></>;
}
function SettingsPage({ user, onLogout }: any) { return <><PageHeading eyebrow="YOUR WORKSPACE" title="Settings" subtitle="Manage your account and keep your workspace secure."/><div className="settings-grid"><div className="panel settings-card"><div className="settings-icon"><Users size={19}/></div><h3>Profile</h3><p>Your signed-in account information.</p><div className="settings-detail"><span>Name</span><b>{user.name}</b></div><div className="settings-detail"><span>Email</span><b>{user.email}</b></div></div><div className="panel settings-card"><div className="settings-icon green"><ShieldCheck size={19}/></div><h3>Security & privacy</h3><p>Your templates, contacts, SMTP accounts, and history are scoped to your account.</p><div className="settings-detail"><span>Session</span><b>HTTP-only cookie</b></div><div className="settings-detail"><span>SMTP secrets</span><b>Encrypted at rest</b></div><div className="settings-detail"><span>Sending</span><b>Rate-limited</b></div></div><div className="panel settings-card"><div className="settings-icon amber"><CircleHelp size={19}/></div><h3>Before public launch</h3><p>This starter still needs email verification, password recovery, CSRF review, monitoring, and an abuse-response workflow before opening registration to everyone.</p></div><div className="panel settings-card"><div className="settings-icon violet"><LogOut size={19}/></div><h3>Sign out</h3><p>End this session on this device.</p><button className="btn secondary" onClick={onLogout}><LogOut size={16}/> Sign out</button></div></div></>; }

function PageHeading({ eyebrow, title, subtitle, action }: any) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="heading-action">{action}</div>}</div>; }
function Field({ label, children }: any) { return <label className="field"><span>{label}</span>{children}</label>; }
function SearchBox({ value, onChange, placeholder }: any) { return <div className="search-row"><div className="search-box"><Search size={17}/><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/>{value && <button className="icon-btn" onClick={() => onChange("")}><X size={15}/></button>}</div></div>; }
function StatusPill({ status }: { status: string }) { return <span className={`status-pill ${status}`}><span/>{status}</span>; }
function Empty({ icon: Icon, title, text, action }: any) { return <div className="empty-state"><div className="empty-icon"><Icon size={22}/></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
function Modal({ title, onClose, children }: any) { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal"><div className="modal-heading"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>; }
function initials(value: string) { return value.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "U"; }
function errText(e: unknown) { return e instanceof Error ? e.message : "Something went wrong. Please try again."; }
