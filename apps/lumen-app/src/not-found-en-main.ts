import './styles/not-found.css';

document.cookie = 'lumen_locale=en; path=/; max-age=31536000; sameSite=lax';
try {
  window.localStorage.setItem('lumen_locale', 'en');
} catch {}
