import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

window.Capacitor = Capacitor;
window.SocialLogin = SocialLogin;

const GOOGLE_CLIENT_ID = "935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com";

// Si se ejecuta en Android o iOS nativo, inicializar SocialLogin
if (Capacitor.isNativePlatform()) {
  SocialLogin.initialize({
    google: {
      webClientId: GOOGLE_CLIENT_ID,
      mode: 'online',
    },
  }).then(() => {
    console.log("SocialLogin nativo inicializado correctamente");
  }).catch((err) => {
    console.warn("Error al inicializar SocialLogin nativo:", err);
  });
}
