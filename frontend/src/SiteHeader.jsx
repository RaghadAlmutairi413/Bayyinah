
const LINKS = [
  ['#burnout', 'Burnout insights'],
  ['#how', 'How it works'],
  ['#about', 'About us'],
  ['#faq', 'FAQ'],
];

export default function SiteHeader() {
  return (
    <div className="mk-sticky">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Bayyinah home">
          <img className="brand-logo" src="/bayyinah-logo.png" alt="" />
          <span>Bayyinah <span className="brand-arabic">بينة</span></span>
        </a>
        <nav className="site-nav" aria-label="Main navigation">
          {LINKS.map(([href, text]) => <a key={href} className="nav-login mk-link" href={href}>{text}</a>)}
          <a className="nav-login" href="/login">Log in</a>
          <a className="button button-primary button-small" href="/setup">Get started</a>
        </nav>
      </header>
    </div>
  );
}
