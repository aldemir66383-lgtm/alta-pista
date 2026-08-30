/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0009 - Nova paleta: azul-noite com lima                     */
/*                                                              */
/*  A cor de acento fica guardada no banco, nao no codigo, para  */
/*  voce poder troca-la pelo Painel a qualquer momento. Esta     */
/*  migracao so muda o valor que ja esta la e o padrao de quem   */
/*  instalar o sistema do zero.                                  */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/* ============================================================ */

alter table public.configuracao
  alter column cor_acento set default '#C6F24E';

update public.configuracao
   set cor_acento = '#C6F24E'
 where cor_acento = '#FFE01B';

/* ============================================================ */
/*  Se voce ja tinha escolhido uma cor propria no Painel, ela    */
/*  e preservada: a troca so alcanca quem estava no amarelo      */
/*  original.                                                    */
/* ============================================================ */
