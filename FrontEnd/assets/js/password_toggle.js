// Mostrar/ocultar contraseña en login y registro.
document.addEventListener("DOMContentLoaded", function () {
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("contrasena");
  const eyeIcon = document.getElementById("eyeIcon");

  if (!togglePassword || !passwordInput || !eyeIcon) return;

  togglePassword.addEventListener("click", function () {
    const isPassword = passwordInput.getAttribute("type") === "password";

    passwordInput.setAttribute("type", isPassword ? "text" : "password");

    if (isPassword) {
      eyeIcon.classList.remove("fa-eye-slash");
      eyeIcon.classList.add("fa-eye");
    } else {
      eyeIcon.classList.remove("fa-eye");
      eyeIcon.classList.add("fa-eye-slash");
    }
  });
});
