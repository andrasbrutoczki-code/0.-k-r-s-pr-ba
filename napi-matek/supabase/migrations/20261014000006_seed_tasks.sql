-- =============================================================================
-- Seed: 5 mintafeladat érettségi stílusban (csak ha még nincs ilyen című feladat)
-- =============================================================================
do $seed$
declare v_task uuid;
begin
  if not exists (select 1 from public.tasks where title = $q$Harmadfokú függvény szélsőértékei$q$) then
    insert into public.tasks (title, body_md, topic_id, difficulty, requires_image)
    values ($q$Harmadfokú függvény szélsőértékei$q$, $q$Adott az $f(x) = x^3 - 6x^2 + 9x + 1$ függvény ($x \in \mathbb{R}$).

a) Határozza meg a függvény lokális szélsőértékhelyeit és szélsőértékeit!

b) Írja fel az $f$ grafikonjához az $x_0 = 0$ abszcisszájú pontban húzott érintő egyenletét!$q$,
            (select id from public.topics where slug = 'analizis'), 3, true)
    returning id into v_task;
    insert into public.task_solutions (task_id, solution_md) values (v_task, $q$a) $f'(x) = 3x^2 - 12x + 9 = 3(x-1)(x-3)$. Előjelvizsgálat: $x = 1$-ben lokális maximum, $f(1) = 5$; $x = 3$-ban lokális minimum, $f(3) = 1$.

b) $f(0) = 1$, $f'(0) = 9$, így az érintő: $y = 9x + 1$.$q$);
  end if;
  if not exists (select 1 from public.tasks where title = $q$Számtani sorozat összege$q$) then
    insert into public.tasks (title, body_md, topic_id, difficulty, requires_image)
    values ($q$Számtani sorozat összege$q$, $q$Egy számtani sorozat harmadik tagja 7, hetedik tagja 19.

a) Mennyi a sorozat első 20 tagjának összege?

b) Hányadik tagja a sorozatnak a 100?$q$,
            (select id from public.topics where slug = 'sorozatok'), 3, true)
    returning id into v_task;
    insert into public.task_solutions (task_id, solution_md) values (v_task, $q$$a_1 + 2d = 7$ és $a_1 + 6d = 19$, innen $d = 3$, $a_1 = 1$.

a) $S_{20} = \frac{20}{2}\,(2 \cdot 1 + 19 \cdot 3) = 590$.

b) $1 + 3(n-1) = 100 \Rightarrow n = 34$.$q$);
  end if;
  if not exists (select 1 from public.tasks where title = $q$Három kockadobás$q$) then
    insert into public.tasks (title, body_md, topic_id, difficulty, requires_image)
    values ($q$Három kockadobás$q$, $q$Egy szabályos dobókockával háromszor dobunk egymás után. Mennyi a valószínűsége, hogy

a) mindhárom dobás páros;

b) legalább egy hatost dobunk;

c) a dobott számok összege 4?$q$,
            (select id from public.topics where slug = 'valoszinuseg'), 2, true)
    returning id into v_task;
    insert into public.task_solutions (task_id, solution_md) values (v_task, $q$Összes eset: $6^3 = 216$.

a) $\left(\frac{1}{2}\right)^3 = \frac{1}{8}$.

b) $1 - \left(\frac{5}{6}\right)^3 = \frac{91}{216}$.

c) Csak az (1; 1; 2) dobások sorrendjei: 3 eset, $P = \frac{3}{216} = \frac{1}{72}$.$q$);
  end if;
  if not exists (select 1 from public.tasks where title = $q$Háromszög koszinusztétellel$q$) then
    insert into public.tasks (title, body_md, topic_id, difficulty, requires_image)
    values ($q$Háromszög koszinusztétellel$q$, $q$Egy háromszög két oldala $a = 8$ cm és $b = 5$ cm, az általuk közrezárt szög $\gamma = 60^\circ$.

a) Számítsa ki a harmadik oldal hosszát!

b) Számítsa ki a háromszög területét!

c) Mekkora a háromszög köré írt kör sugara?$q$,
            (select id from public.topics where slug = 'trigonometria'), 3, true)
    returning id into v_task;
    insert into public.task_solutions (task_id, solution_md) values (v_task, $q$a) $c^2 = 64 + 25 - 2 \cdot 8 \cdot 5 \cdot \cos 60^\circ = 49$, így $c = 7$ cm.

b) $T = \frac{1}{2} \cdot 8 \cdot 5 \cdot \sin 60^\circ = 10\sqrt{3} \approx 17{,}32$ cm².

c) $R = \frac{c}{2\sin\gamma} = \frac{7}{\sqrt{3}} \approx 4{,}04$ cm.$q$);
  end if;
  if not exists (select 1 from public.tasks where title = $q$Kör érintője$q$) then
    insert into public.tasks (title, body_md, topic_id, difficulty, requires_image)
    values ($q$Kör érintője$q$, $q$Adott a $k\colon x^2 + y^2 - 6x + 4y - 12 = 0$ egyenletű kör.

a) Határozza meg a kör középpontját és sugarát!

b) Igazolja, hogy a $P(7;\,1)$ pont illeszkedik a körre, és írja fel a kör $P$ pontbeli érintőjének egyenletét!$q$,
            (select id from public.topics where slug = 'koordinatageom'), 4, true)
    returning id into v_task;
    insert into public.task_solutions (task_id, solution_md) values (v_task, $q$a) $(x-3)^2 + (y+2)^2 = 25$, így $K(3;\,-2)$, $r = 5$.

b) $(7-3)^2 + (1+2)^2 = 25$ ✓. Az érintő normálvektora $\overrightarrow{KP} = (4;\,3)$, egyenlete: $4x + 3y = 31$.$q$);
  end if;
end $seed$;
