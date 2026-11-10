// Loaded before every renderer, including the retained upstream JavaScript views.
// Migrate only appearance; provider settings and other localStorage remain intact.
localStorage.setItem('selectedTheme', 'titan');
function applyTitanAppearance() {
    document.body.classList.remove('theme-original', 'theme-chinese', 'theme-west');
    document.body.classList.add('theme-titan');
}
if (document.body) applyTitanAppearance();
else document.addEventListener('DOMContentLoaded', applyTitanAppearance, { once: true });
