import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { clearLogin, displayName, getLogin } from './api.js';
import { Avatar, Icon } from './taskUi.jsx';

const LINKS = {
  Manager: [
    ['/dashboard/manager', 'Overview', 'layout'],
    ['/manager/projects', 'Projects', 'folder'],
    ['/manager/tasks', 'Tasks', 'tasks'],
    ['/manager/goals', 'Performance', 'flag'],
  ],
  Employee: [
    ['/dashboard/employee', 'Overview', 'layout'],
    ['/employee/tasks', 'My tasks', 'tasks'],
    ['/employee/performance', 'Performance', 'flag'],
  ],
  HR: [
    ['/dashboard/hr', 'Overview', 'layout'],
    ['/dashboard/hr#overview', 'Dashboards', 'folder'],
    ['/dashboard/hr#team', 'People', 'users'],
    ['/hr/employees', 'Manage employees', 'users'],
    ['/dashboard/hr#import', 'Import team', 'plus'],
    ['/hr/performance', 'Performance', 'flag'],
  ],
};

// The project details page belongs to the Projects menu item.
function isActive(path) {
  const current = window.location.pathname;
  const [base, hash = ''] = path.split('#');
  if (current !== base && !(base === '/manager/projects' && current === '/manager/project')) return false;
  // Links such as /dashboard/hr#team are told apart by the part after the #.
  if (base !== '/dashboard/hr') return true;
  return window.location.hash.replace('#', '') === hash;
}

export function Banner({ message, isError, onClose }) {
  if (!message) return null;
  return (
    <div className={`ws-banner${isError ? ' ws-banner-error' : ''}`} role={isError ? 'alert' : 'status'}>
      <Icon name={isError ? 'alert' : 'check'} size={16} />
      <span>{message}</span>
      {onClose && (
        <button type="button" className="ws-banner-close" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

// Lets a page put its main buttons in the top bar: <HeaderActions>...</HeaderActions>
export function HeaderActions({ children }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    setTarget(document.getElementById('ws-header-actions'));
  }, []);
  return target ? createPortal(children, target) : null;
}

// Page layout shared by the manager and employee workspace screens.
// It also checks that the person is logged in with the right role.
export default function Shell({ role, title, subtitle, breadcrumbs = [], children }) {
  const [login, setLogin] = useState(null);
  const [, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const savedLogin = getLogin();
    if (!savedLogin) {
      window.location.replace('/login');
      return;
    }
    const savedRole = savedLogin.user.role === 'HR Professional' ? 'HR' : savedLogin.user.role;
    if (savedRole !== role) {
      const home = savedLogin.user.role === 'Manager' ? '/dashboard/manager' : '/dashboard/employee';
      const isHr = savedLogin.user.role === 'HR' || savedLogin.user.role === 'HR Professional';
      window.location.replace(isHr ? '/dashboard/hr' : home);
      return;
    }
    setLogin(savedLogin);
  }, [role]);

  function logout() {
    clearLogin();
    window.location.assign('/');
  }

  if (!login) {
    return <div className="ws-app ws-loading">Opening your workspace…</div>;
  }

  return (
    <div className="ws-app">
      <aside className="ws-sidebar">
        <a className="ws-brand" href="/" aria-label="Bayyinah home">
          <img src="/bayyinah-logo.png" alt="" />
          <span>Bayyinah</span>
        </a>
        <nav className="ws-nav" aria-label="Workspace navigation">
          {LINKS[role].map(([path, text, icon]) => (
            <a key={path} href={path} className={isActive(path) ? 'active' : ''} aria-current={isActive(path) ? 'page' : undefined}>
              <Icon name={icon} size={17} />
              {text}
            </a>
          ))}
        </nav>
        <div className="ws-sidebar-footer">
          <Avatar name={displayName(login.user)} size={32} />
          <div className="ws-user">
            <span className="ws-user-name">{displayName(login.user)}</span>
            <span className="ws-user-role">{login.user.role}</span>
          </div>
          <button type="button" className="ws-icon-btn" onClick={logout} aria-label="Log out" title="Log out">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      <div className="ws-main">
        <header className="ws-topbar">
          <div>
            {breadcrumbs.length > 0 && (
              <nav className="ws-crumbs" aria-label="Breadcrumb">
                {breadcrumbs.map(([text, href], index) => (
                  <span key={text}>
                    {index > 0 && <Icon name="chevron" size={12} className="ws-crumb-sep" />}
                    {href ? <a href={href}>{text}</a> : <span aria-current="page">{text}</span>}
                  </span>
                ))}
              </nav>
            )}
            <h1 className="ws-title">{title}</h1>
            {subtitle && <p className="ws-subtitle">{subtitle}</p>}
          </div>
          <div className="ws-header-actions" id="ws-header-actions" />
        </header>
        <main className="ws-content">{children}</main>
      </div>
    </div>
  );
}