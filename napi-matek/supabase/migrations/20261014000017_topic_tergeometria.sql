-- Térgeometria (testek felszíne, térfogata) 29. témakörként, a Síkgeometria után.
update public.topics set sort_order = sort_order + 1 where not retired and sort_order >= 13;
insert into public.topics (slug, name, sort_order) values ('tergeometria', 'Térgeometria', 13);
