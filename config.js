window.SUPABASE_CONFIG = {
  brandName: "LittleAPI",
  brandDomain: "https://littleapi.online",
  url: "https://dnwaapropjmoyqxquzvs.supabase.co",
  publishableKey: "sb_publishable_Yik47TNnUdzBHy-S0WMM4w_v_YkWMKP",
  googleClientId: "934959548251-9ismqh887fueuja0ji0745cp4tmh5i4n.apps.googleusercontent.com",
  apiBase: "https://littleapi.online/api/v1"
};

(() => {
  const loadLandingUpgrades = () => {
    const home = document.querySelector('#public-home');
    if (!home || document.querySelector('script[data-littleapi-landing-upgrades]')) return;
    const syncVisibility = () => {
      const section = document.querySelector('#littleapi-modern-features');
      if (section) section.classList.toggle('hidden', home.classList.contains('hidden'));
    };
    const script = document.createElement('script');
    script.src = 'landing-upgrades.js?v=20260917-1';
    script.dataset.littleapiLandingUpgrades = 'true';
    script.onload = () => {
      syncVisibility();
      new MutationObserver(syncVisibility).observe(home, { attributes:true, attributeFilter:['class'] });
    };
    document.body.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLandingUpgrades, { once:true });
  else loadLandingUpgrades();
})();
