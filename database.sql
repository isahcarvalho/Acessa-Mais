-- ACESSA+ | Banco inicial para Supabase
-- Execute este arquivo inteiro no SQL Editor do seu projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role) values (new.id, 'user') on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null,
  address text,
  phone text,
  description text,
  source_url text,
  accessibility jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  feature_key text not null,
  suggested_status text not null check (suggested_status in ('Confirmado','Não disponível','Não informado','Em verificação')),
  note text not null check (char_length(note) between 8 and 700),
  contact text,
  review_status text not null default 'Pendente' check (review_status in ('Pendente','Aprovada','Rejeitada')),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  problem_type text not null,
  location_text text not null,
  description text not null,
  status text not null default 'Recebido' check (status in ('Recebido','Em análise','Encaminhado ao responsável','Resolvido')),
  created_at timestamptz not null default now()
);

-- Segurança: habilita RLS em todas as tabelas expostas.
alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.suggestions enable row level security;
alter table public.reports enable row level security;

-- Remove políticas antigas deste conjunto, para permitir reexecutar o script.
drop policy if exists "Public can read published places" on public.places;
drop policy if exists "Admins manage places" on public.places;
drop policy if exists "Public can submit suggestions" on public.suggestions;
drop policy if exists "Admins read suggestions" on public.suggestions;
drop policy if exists "Admins update suggestions" on public.suggestions;
drop policy if exists "Public can submit reports" on public.reports;
drop policy if exists "Admins read reports" on public.reports;
drop policy if exists "Admins update reports" on public.reports;
drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Admins read profiles" on public.profiles;

create policy "Public can read published places" on public.places
for select to anon, authenticated using (published = true);
create policy "Admins manage places" on public.places
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Public can submit suggestions" on public.suggestions
for insert to anon, authenticated with check (review_status = 'Pendente');
create policy "Admins read suggestions" on public.suggestions
for select to authenticated using (public.is_admin());
create policy "Admins update suggestions" on public.suggestions
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Public can submit reports" on public.reports
for insert to anon, authenticated with check (status = 'Recebido');
create policy "Admins read reports" on public.reports
for select to authenticated using (public.is_admin());
create policy "Admins update reports" on public.reports
for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Users read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()));
create policy "Admins read profiles" on public.profiles
for select to authenticated using (public.is_admin());

-- Permissões mínimas para a API de dados.
grant usage on schema public to anon, authenticated;
grant select on public.places to anon, authenticated;
grant insert on public.suggestions, public.reports to anon, authenticated;
grant select, update on public.suggestions, public.reports to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.places to authenticated;

-- Cadastro inicial: informações de acessibilidade começam como Não informado.
-- Não significa que o local não possua o recurso; significa que a equipe ainda não verificou.
insert into public.places (slug,name,category,address,phone,description,source_url,accessibility) values
('vilhenus-carlos-borges','Vilhenus Doceria — unidade Carlos Borges','Doceria e cafeteria','Av. Carlos Correa Borges, 1960, Maringá–PR, CEP 87060-025','(44) 99898-2106','Cadastro limitado à unidade da Avenida Carlos Correa Borges. Confirmar dados diretamente com o estabelecimento.','https://www.google.com/maps/search/?api=1&query=Vilhenus+Doceria+Carlos+Borges+Maringa', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('mandacaru-cafe','Mandacaru Café','Cafeteria','Av. Mandacaru, 695, Vila Santa Izabel, Maringá–PR','(44) 3346-8445','Cadastro inicial. Confirmar endereço, contato e funcionamento antes de visitar.','https://festivalbomgourmet.com.br/2-festival-bom-gourmet-maringa/restaurantes/estabelecimento/mandacaru-cafe', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('mercadao-fratello','Mercadão Fratello','Gastronomia, compras e lazer','Av. Herval, 969, Zona 07, Maringá–PR, CEP 87020-016','(44) 99821-0646','Espaço gastronômico e de compras. Recursos de acessibilidade aguardam verificação.','https://www.mercadaofratello.com.br/', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('terminal-urbano','Terminal Urbano Intermodal Dr. Said Felício Ferreira','Transporte público','Av. Adv. Horácio Raccanello Filho, 667, Zona 07, Maringá–PR, CEP 87020-035',null,'Consultar canais oficiais para linhas, horários e condições atuais.','https://www.google.com/maps/search/?api=1&query=Terminal+Urbano+Intermodal+Maringa', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('aeroporto-maringa','Aeroporto Regional de Maringá — Sílvio Name Júnior','Transporte aéreo','Av. Doutor Vladimir Babkov, Parque Industrial II, Maringá–PR, CEP 87065-665',null,'Aeroporto regional. Consultar a administração para informações de acessibilidade e atendimento.','https://www.aeroportomaringa.com.br/', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('delegacia-mulher','Delegacia da Mulher de Maringá','Segurança e serviço público','Rua Júlio Meneguetti, 195, Jardim Novo Horizonte, Maringá–PR, CEP 87010-230','(44) 3220-2500','Confirmar atendimento e contatos nos canais oficiais da Polícia Civil do Paraná.','https://www.policiacivil.pr.gov.br/DPI', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('delegacia-cidada','Delegacia Cidadã de Maringá','Segurança e serviço público','Rua Pioneiro Thiago Netto, 331, Centro Cívico, Maringá–PR, CEP 87051-030','(44) 3366-7100','Confirmar serviços, endereço e horários nos canais oficiais.','https://www.policiacivil.pr.gov.br/', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('gela-boca-mandacaru','Gela Boca — referência Av. Mandacaru','Sorveteria','Av. Mandacaru, 695, Vila Santa Izabel, Maringá–PR','(44) 3025-6659','Cadastro a confirmar: conferir se a unidade e o endereço continuam ativos.','https://www.google.com/maps/search/?api=1&query=Gela+Boca+Maringa+PR', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('ice-cream-palace','Ice Cream Palace — cadastro a confirmar','Sorveteria','Av. Paraná, 1512, sala 8, Zona 07, Maringá–PR, CEP 87020-085','(44) 99955-4444','Confirmar nome comercial, endereço e funcionamento antes de utilizar este cadastro.','https://www.google.com/maps/search/?api=1&query=Ice+Cream+Palace+Maringa+PR', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('catedral-maringa','Catedral Basílica Menor Nossa Senhora da Glória','Religião e turismo','Praça da Catedral, s/n, Centro, Maringá–PR',null,'Ponto religioso e turístico. Recursos de acessibilidade ainda não foram verificados pela equipe.','https://www.google.com/maps/search/?api=1&query=Catedral+de+Maringa', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('parque-do-inga','Parque do Ingá','Lazer e natureza','Av. São Paulo, Zona 1, Maringá–PR',null,'Parque urbano. Consultar a administração para condições atuais de circulação e visitação.','https://www.google.com/maps/search/?api=1&query=Parque+do+Inga+Maringa', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}'),
('parque-do-japao','Parque do Japão','Lazer e cultura','Rua Tulipa, 987, Jardim Industrial, Maringá–PR',null,'Espaço de lazer e cultura. Confirmar horários e condições de acessibilidade com a administração.','https://www.google.com/maps/search/?api=1&query=Parque+do+Japao+Maringa', '{"ramp":"Não informado","step_free":"Não informado","restroom":"Não informado","elevator":"Não informado","tactile":"Não informado","braille":"Não informado","audio":"Não informado","libras":"Não informado","visual":"Não informado","simple_language":"Não informado"}')
on conflict (slug) do nothing;
-- =========================
-- AVISOS DE ACESSIBILIDADE
-- =========================

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (
    category in ('Obras','Manutenção','Novidade')
  ),
  description text not null,
  location text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.alerts enable row level security;

drop policy if exists "Public can read published alerts" on public.alerts;
drop policy if exists "Admins manage alerts" on public.alerts;

create policy "Public can read published alerts"
on public.alerts
for select
to anon, authenticated
using (published = true);

create policy "Admins manage alerts"
on public.alerts
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.alerts to anon, authenticated;
grant insert, update, delete on public.alerts to authenticated;
