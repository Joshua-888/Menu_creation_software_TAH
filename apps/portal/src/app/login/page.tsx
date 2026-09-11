import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "../../lib/session";

export default async function LoginPage() {
  const emp = await getCurrentEmployee();
  if (emp) redirect("/jobs");

  return (
    <main className="hero-login">
      <div className="login-panel">
        <p className="muted" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          Employee access only
        </p>
        <h1 className="login-brand">
          TakeAway<em>Hero</em>
        </h1>
        <p className="login-sub">
          Internal menu operator portal — start merchant migrations from a
          browser, with dry-run artifacts and a focused review queue.
        </p>
        <LoginForm />
        <p className="muted" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
          Need an account? Ask an admin to seed your credentials.
        </p>
      </div>
    </main>
  );
}

function LoginForm() {
  return (
    <form action="/api/auth/login" method="post" id="login-form">
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <p id="login-error" className="error" hidden />
      <button className="btn" type="submit" style={{ width: "100%" }}>
        Sign in
      </button>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var form = document.getElementById('login-form');
              if (!form) return;
              form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var err = document.getElementById('login-error');
                err.hidden = true;
                var fd = new FormData(form);
                var res = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: fd.get('email'),
                    password: fd.get('password'),
                  }),
                });
                if (!res.ok) {
                  var data = await res.json().catch(function () { return {}; });
                  err.textContent = data.error || 'Sign in failed';
                  err.hidden = false;
                  return;
                }
                window.location.href = '/jobs';
              });
            })();
          `,
        }}
      />
      <noscript>
        <p className="muted">JavaScript is required to sign in.</p>
      </noscript>
      <p style={{ marginTop: "1rem" }}>
        <Link className="muted" href="/jobs">
          Continue if already signed in
        </Link>
      </p>
    </form>
  );
}
