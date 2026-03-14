# Autenticación de Perfilio - Configuración

## ✅ Sistema de Autenticación Implementado

El sistema de autenticación está completamente configurado usando **Supabase Auth** con `@supabase/ssr`.

### Archivos Creados:

#### 1. Clientes de Supabase
- `lib/supabase/client.ts` - Cliente para el navegador
- `lib/supabase/server.ts` - Cliente para Server Components
- `lib/supabase/middleware.ts` - Cliente para middleware

#### 2. Middleware
- `middleware.ts` - Protege rutas del dashboard automáticamente

#### 3. Páginas
- `app/login/page.tsx` - Página de inicio de sesión
- `app/dashboard/page.tsx` - Dashboard protegido (ejemplo)
- `app/dashboard/logout-button.tsx` - Componente de cerrar sesión

### Rutas Protegidas:
- ✅ `/dashboard/*` - Requiere autenticación
- ✅ `/login` - Pública (redirige al dashboard si ya estás autenticado)
- ✅ `/` - Landing pública
- ✅ `/api/*` - APIs públicas

---

## 🔧 Configuración de Usuarios en Supabase

### Opción 1: Crear Usuario desde el Dashboard de Supabase

1. Ve a tu proyecto en https://supabase.com/dashboard
2. En el menú lateral, selecciona **Authentication** → **Users**
3. Click en **Add User** (botón verde)
4. Rellena:
   - **Email**: tu@email.com
   - **Password**: tu contraseña segura
   - Marca "Auto Confirm User" para que no necesite verificación por email
5. Click en **Create User**

### Opción 2: Permitir Registro Público (opcional)

Si quieres que los usuarios se registren por sí mismos:

1. En Supabase Dashboard → **Authentication** → **Settings**
2. En **Email Auth** asegúrate de que esté activado
3. Puedes crear una página de registro (`/app/register/page.tsx`) siguiendo el mismo patrón que login pero usando:
   ```typescript
   await supabase.auth.signUp({ email, password })
   ```

### Opción 3: Crear Usuario Vía SQL (Terminal)

En el **SQL Editor** de Supabase, ejecuta:

```sql
-- Crear un usuario de prueba
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'test@perfilio.com',
  crypt('password123', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  FALSE,
  ''
);
```

---

## 🚀 Probar la Autenticación

### 1. Iniciar el servidor de desarrollo:
```bash
npm run dev
```

### 2. Navegar a:
- http://localhost:3000/login

### 3. Credenciales de prueba (si creaste el usuario arriba):
- **Email**: test@perfilio.com
- **Password**: password123

### 4. Flujo completo:
1. Ve a `/login`
2. Ingresa credenciales
3. Click en "Iniciar Sesión"
4. Deberías ser redirigido a `/dashboard`
5. Click en "Cerrar Sesión" para volver a `/login`
6. Intenta acceder a `/dashboard` sin estar autenticado → redirige a `/login`

---

## 🔐 Variables de Entorno

Asegúrate de tener en tu `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

Estos valores los encuentras en:
**Supabase Dashboard** → **Settings** → **API**

---

## 📝 Notas Importantes

1. **Middleware automático**: El archivo `middleware.ts` protege automáticamente todas las rutas `/dashboard/*`
2. **Sesiones persistentes**: Las sesiones se guardan en cookies y se refrescan automáticamente
3. **Server Components**: El dashboard usa Server Components para verificar la sesión del lado del servidor
4. **Diseño Perfilio**: Los colores y estilos coinciden con la landing (navy #1a365d, orange #ed8936)

---

## 🎨 Personalización

### Cambiar rutas protegidas:
Edita `middleware.ts` en la raíz del proyecto.

### Agregar más campos al login:
Edita `app/login/page.tsx`.

### Personalizar el dashboard:
Edita `app/dashboard/page.tsx` - actualmente es un ejemplo básico.

---

## ✅ Estado Actual

- ✅ Sistema de autenticación completo
- ✅ Login funcional con diseño Perfilio
- ✅ Dashboard protegido con middleware
- ✅ Botón de logout funcional
- ✅ Redirecciones automáticas
- ✅ Manejo de errores
- ✅ States de carga
- ✅ Sin errores de linting

**¡El sistema está listo para usar!** 🎉
