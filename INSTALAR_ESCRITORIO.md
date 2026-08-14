# Instalar JG Turbo como aplicación de escritorio

JG Turbo ya es una **PWA** (Progressive Web App): la misma tecnología que en el móvil
permite “Instalar app”. En Windows no hace falta un `.exe` ni un acceso directo
manual: **Chrome o Edge** la registran como aplicación del sistema.

**URL:** https://jg-turbo.vercel.app

---

## Windows (recomendado): Chrome o Microsoft Edge

### Opción A — Icono en la barra de direcciones

1. Abre **https://jg-turbo.vercel.app** en **Chrome** o **Edge**.
2. A la derecha de la barra de direcciones busca el icono **⊕ Instalar** o
   **“Instalar JG Turbo”**.
3. Pulsa **Instalar** y confirma.
4. Se abre una ventana **sin pestañas ni barra de direcciones**.
5. En el menú **Inicio** de Windows aparece **JG Turbo**.
6. (Opcional) Clic derecho en la app → **Anclar a la barra de tareas**.

### Opción B — Menú del navegador

**Chrome**

1. Menú **⋮** (arriba a la derecha).
2. **Guardar y compartir** → **Instalar página como aplicación…**  
   (en versiones antiguas: **Instalar JG Turbo…**).
3. Confirma **Instalar**.

**Edge**

1. Menú **⋯**.
2. **Aplicaciones** → **Instalar este sitio como una aplicación…**.
3. Confirma **Instalar**.

### Cómo se ve cuando está bien instalada

| Sí es app de escritorio | Solo es acceso directo del navegador |
|---|---|
| Ventana propia, sin URL visible | Se abre una pestaña de Chrome/Edge |
| Icono en Inicio / barra de tareas | Solo un favorito o `.url` |
| En el Administrador de tareas puede figurar como app | Figura como el navegador |

### Desinstalar

- Windows: **Configuración → Aplicaciones → JG Turbo → Desinstalar**, o  
- Dentro de la app: menú **⋯** de la ventana → **Desinstalar JG Turbo**.

---

## Móvil (recordatorio)

| Sistema | Cómo instalar |
|---|---|
| **Android (Chrome)** | Menú ⋮ → Instalar app / Añadir a pantalla principal |
| **iPhone (Safari)** | Compartir → Añadir a pantalla de inicio |

En Android, con la app instalada puedes **Compartir un audio de WhatsApp → JG Turbo**.

---

## Dentro de la web

Si el navegador permite la instalación, verás:

- Botón **«Instalar app»** arriba a la derecha (junto a Servidor e IA).
- Un aviso en la pestaña **Archivo** con el mismo botón.

Al pulsarlos se abre el diálogo nativo de instalación. Si el navegador no lo
ofrece (por ejemplo Firefox), se muestra esta guía en un mensaje.

---

## Requisitos

- Sitio en **HTTPS** (ya lo es: jg-turbo.vercel.app).
- **Chrome** o **Edge** actualizados (mejor experiencia en Windows).
- Firefox / Safari de escritorio: la instalación PWA es limitada o inexistente;
  usa Chrome o Edge para escritorio.

---

## ¿Por qué no un instalador .exe?

Una PWA es la app real que ya usas en la nube: se actualiza sola con cada
despliegue, no hay que descargar paquetes ni administrar versiones. Un `.exe` tipo
Electron duplicaría la app y la mantendría desactualizada. Si en el futuro
quisieras un instalador empaquetado (MSIX / Electron), sería un proyecto aparte.

---

## Comprobación rápida

1. Instala con Chrome o Edge.  
2. Cierra todas las pestañas de jg-turbo.vercel.app.  
3. Abre **JG Turbo** desde el menú Inicio.  
4. Debe verse a pantalla de app (sin barra de direcciones).  
5. Dicta o sube un audio: funciona igual que en la web.
