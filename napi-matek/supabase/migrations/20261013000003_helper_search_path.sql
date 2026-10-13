-- Rögzített search_path a segédfüggvényeken (Supabase advisor: function_search_path_mutable).
-- Csak pg_catalog-függvényeket használnak, így az üres search_path biztonságos.
alter function public.normalize_login_name(text) set search_path = '';
alter function public.normalize_login_code(text) set search_path = '';
alter function public.today_bp() set search_path = '';
alter function public.end_of_day_bp(date) set search_path = '';
