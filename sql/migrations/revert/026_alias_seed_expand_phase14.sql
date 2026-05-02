-- Revert openf1:026_alias_seed_expand_phase14 from pg
--
-- Targeted DELETEs of the rows added by deploy. Each delete is by
-- the unique tuple the partial-unique index keys on.

BEGIN;

DELETE FROM core.driver_alias_lookup
 WHERE alias_text IN (
   'super max','mad max','lewis','lewis hamilton','ham','george','george russell','rus','mr saturday',
   'yuki','yuki tsunoda','tsu','fernando','fernando alonso','alo','magic alonso','nano',
   'norris','nor','pia','oscar piastri','sergio','sergio perez','perez','pérez','per','checo','checo perez',
   'carlos','carlos sainz','carlos sainz jr','sainz','sai','smooth operator',
   'nico','nico hulkenberg','hulkenberg','hülkenberg','hul','hulk',
   'alex','alex albon','alexander albon','albon','alb',
   'esteban','esteban ocon','ocon','oco','pierre','pierre gasly','gasly','gas',
   'lance','lance stroll','stroll','str','valtteri','valtteri bottas','bottas','bot',
   'zhou','guanyu zhou','zhou guanyu','zho','kevin','kevin magnussen','magnussen','mag','k mag',
   'logan','logan sargeant','sargeant','sar','liam','liam lawson','lawson','law',
   'oliver','oliver bearman','bearman','bea','ollie',
   'jos verstappen','jos','verstappen sr'
 );

DELETE FROM core.team_alias_lookup
 WHERE alias_text IN (
   'rbr','energy drink','prancing horse','maranello','mer','silver arrows','mcl','papaya',
   'ast','green','alp','wil','has','toro rosso','visa cash app rb','visa cash app racing bulls',
   'mercedes-amg petronas','oracle red bull racing'
 );

DELETE FROM core.session_venue_alias_lookup
 WHERE alias_text IN (
   'britain','britain gp','italy gp','monza gp','sao paulo','são paulo','sao paulo gp','brazilian gp',
   'brazil','interlagos','mexico','mexico city','mexico city gp','mexican gp','qatar','qatar gp','lusail',
   'canadian gp','canada','montreal','montréal','gilles villeneuve','spanish gp','spain','catalunya','barcelona',
   'chinese gp','china','shanghai','australian gp','australia','melbourne','albert park','dutch gp',
   'netherlands','zandvoort','hungarian gp','hungary','hungaroring','azerbaijan gp','azerbaijan','baku',
   'austrian gp','austria','spielberg','red bull ring','japanese','saudi arabian gp',
   'the ardennes','the tilkedrome','yas'
 );

COMMIT;
