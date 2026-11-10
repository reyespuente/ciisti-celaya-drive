# CIISTI

Demostración educativa para el Instituto Tecnológico de Celaya. Gestor de archivos inspirado en el patrón de una unidad en la nube. Proyecto independiente, sin relación con Google Drive.

## Arquitectura principal: Workers Free

- React + Vite en Vercel Hobby.
- API en Cloudflare Workers Free (`worker/index.js`).
- Supabase Auth y Postgres con RLS por propietario.
- Archivos privados en R2 mediante binding nativo `BUCKET` limitado a `ciisti-drive`.
- DNS de `ciisti.sakuranet.mx` en Cloudflare.

La cuenta Render exigió verificar tarjeta incluso para Free. La API principal se adaptó a Workers; el servidor Express se conserva como alternativa.

## Publicación con Workers (ruta elegida)

1. Crea el proyecto Supabase Free y ejecuta `supabase.sql` una vez. Crea dos usuarios de ensayo con correos bajo tu control y contraseñas ingresadas por ti. La app tiene inicio de sesión, no registro.
2. Activa R2 y crea el bucket privado `ciisti-drive` en Standard. Mantén deshabilitado el acceso público. R2 requiere facturación aunque incluya cuotas gratuitas.
3. Completa `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `ALLOWED_ORIGINS` en `wrangler.jsonc`. El binding `BUCKET` apunta solo a `ciisti-drive`. No usar claves S3 ni service_role.
4. Ejecuta `npx wrangler login` y autoriza tú la cuenta. Publica con `npx wrangler deploy`. Alternativamente pega un bundle de `worker/index.js` y sus importaciones en el editor del panel.
5. Comprueba `/health` en la URL real workers.dev: debe devolver ok y runtime cloudflare-workers. `/api/entries` sin sesión debe responder 401.
6. Importa el repo en Vercel: Vite, build `npm run build`, output `dist`, Hobby. Define `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_API_URL` (URL HTTPS real del Worker). Son valores públicos incorporados al compilar; cambiar variables requiere nuevo despliegue. También puedes subir el frontend ya compilado con esos valores mediante el flujo de archivos de Vercel.
7. Añade `ciisti.sakuranet.mx` en Domains de Vercel. Busca primero si existe el registro. Crea únicamente CNAME `ciisti` hacia el destino exacto del proyecto, inicialmente DNS only. No cambiar otros registros.
8. Configura ALLOWED_ORIGINS del Worker con los orígenes HTTPS exactos, separados por coma, sin barra final ni comodines. Verifica dos usuarios, carga, descarga, persistencia y HTTPS.

Cargas y descargas pasan por Workers con sesión verificada. La API conserva RLS al consultar con el token del usuario. No requiere CORS del bucket; sí CORS exacto del backend. R2 no cobra egreso directo; Workers conserva sus cuotas de CPU y solicitudes (Free: 100,000/día, 10 ms CPU/invocación). El límite de 60 solicitudes por usuario/minuto vive en memoria del isolate y no es global ni persistente.

Las secciones Render siguientes describen una variante alternativa; no son pasos adicionales del despliegue principal.

## Inicio local

Requiere Node 22 o superior y npm.

```sh
npm install
npm run dev
```

Sin las tres variables VITE de nube, abre el modo de práctica. Guarda archivos y metadatos en IndexedDB del navegador. No contacta Supabase ni R2. Es un respaldo para la charla, no almacenamiento en la nube ni una copia de seguridad duradera.

Para conectar los servicios, copia `.env.example` a `.env`, completa los valores y usa dos terminales:

```sh
node --env-file=.env server/index.js
npm run dev
```

Pruebas y compilación:

```sh
npm test
npm run build
```

También se incluye `pnpm-lock.yaml`. Vercel detectará ese gestor y usará las versiones resueltas. El ejemplo de instalación de Render usa npm para mantener los pasos sencillos. Para fijar también su instalación, genera y conserva un package-lock.json o configura pnpm con su archivo de bloqueo.

## Variante de publicación: Node / Render

1. Crea un proyecto Supabase Free. Ejecuta `supabase.sql` una vez. En Authentication > Users crea al menos dos usuarios de prueba desde el panel con correos bajo tu control y contraseñas que ingreses tú. La app solo tiene inicio de sesión. Puedes cerrar el alta pública en Supabase para esta demo.
2. En Cloudflare activa R2 y crea el bucket **privado** `ciisti-drive`, clase Standard. Crea credenciales S3 con lectura/escritura limitadas solo a ese bucket. Nunca uses una clave global de la cuenta.
3. Sube el código a tu repositorio Git. No subas `.env`, dependencias ni archivos personales.
4. En Render: New > Web Service > repositorio. Runtime Node, build `npm install`, start `npm start`, instancia **Free**, health `/health`. Agrega las variables de backend de `.env.example`. Usa `SUPABASE_PUBLISHABLE_KEY` o la clave pública anon heredada, nunca service_role. No guardes archivos en el disco de Render.
5. En Vercel: importa el repositorio, framework Vite, build `npm run build`, output `dist`. Define `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL` (URL HTTPS real de Render). Selecciona Hobby. Las variables VITE se incorporan al compilar, por lo que debes volver a desplegar si las cambias.
6. Añade `ciisti.sakuranet.mx` en Domains de Vercel. En Cloudflare crea el CNAME `ciisti` hacia el destino exacto que muestre Vercel. Empieza con **DNS only** hasta que Vercel valide dominio y TLS. No cambies otros registros ni los nameservers.
7. Añade el origen HTTPS definitivo en `ALLOWED_ORIGINS` de Render. Para probar antes de DNS puedes añadir temporalmente la URL exacta de producción `.vercel.app`, separada por coma. Evita comodines.
8. Verifica con dos usuarios que cada uno solo ve y descarga sus archivos. Prueba carga, descarga, renombrado, favoritos, papelera y restauración. Comprueba `/health`, certificado HTTPS y persistencia después de un nuevo despliegue.

La app envía la carga a través de Render para imponer un límite de 10 MiB en servidor. Por ello esa transferencia a R2 **consume egreso de Render**. La descarga va directamente a R2 con un enlace temporal y no pasa por Render. Para volúmenes mayores conviene diseñar cargas directas firmadas con verificación de tamaño y cuota en servidor.

No hace falta CORS de R2 en esta implementación: la carga a R2 ocurre servidor a servidor y la descarga es una navegación del navegador. CORS de la API en Render sí debe permitir el frontend. Una variante de carga directa desde el navegador requeriría CORS del bucket y validación adicional.

## Alcance y límites de la demo

Carpetas, archivos, búsqueda, favoritos, cambio de nombre, papelera, restauración y eliminación definitiva con confirmación. Máximo 10 MiB por carga. Las carpetas deben estar vacías antes de ir a papelera. El listado consulta hasta 1,000 entradas por usuario. No incluye colaboración, enlaces públicos compartidos, vista previa de documentos, control de versiones ni sincronización con el escritorio.

El medidor muestra bytes de metadatos, no una cuota dura de cuenta. La papelera sigue ocupando R2. Las subidas concurrentes no tienen una cuota global transaccional. El límite de 60 solicitudes por usuario/minuto vive en memoria y reinicia con el servicio. Para abrir registro a muchas personas, agregar cuotas atómicas, límites distribuidos, paginación y análisis de archivos. R2 y SQL son sistemas separados: una falla parcial requiere revisar objetos huérfanos o metadatos sin objeto. La compensación de subida intenta borrar el objeto si falla la escritura SQL.

## Secretos

Los únicos valores públicos del frontend son URL de Supabase, su clave publicable y URL de la API. Las claves de R2 solo van en Render. El backend verifica la sesión con Supabase y realiza consultas con el token del usuario para conservar RLS. Los objetos llevan un prefijo de propietario comprobado antes de firmar descargas o eliminar.

## Estado de entrega

El código se prepara para publicar en las cuentas del ponente. La existencia de archivos de configuración no demuestra que los servicios estén desplegados. Consultar el estado real del despliegue y las verificaciones de nube en el mensaje de entrega.

La credencial S3 temporal preparada para Render no se usa en Workers. Su vencimiento no afecta al binding nativo. Si se usa la variante Render, renovar únicamente esa credencial limitada y actualizar sus secretos.
