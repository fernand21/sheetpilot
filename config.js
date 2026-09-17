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
    if (!document.querySelector('#public-home') || document.querySelector('script[data-littleapi-landing-upgrades]')) return;
    const script = document.createElement('script');
    script.src = 'landing-upgrades.js?v=20260917-1';
    script.dataset.littleapiLandingUpgrades = 'true';
    document.body.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLandingUpgrades, { once:true });
  else loadLandingUpgrades();
})();
