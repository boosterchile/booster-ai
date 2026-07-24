-- =============================================================================
-- SEED — carga SINTÉTICA real sobre PLFL57 (desbloquea historial por carga #615)
-- =============================================================================
-- Crea UNA carga entregada end-to-end (viaje + oferta + asignación + métricas)
-- apuntando al vehículo real PLFL57, para que la vista de historial POR CARGA
-- tenga datos. La telemetría NO se toca (es real): la vista deriva la ventana de
-- traza de [viajes.recogida_ventana_inicio → asignaciones.entregado_en] sobre
-- asignaciones.vehiculo_id.
--
-- Decisiones confirmadas por Felipe (2026-07-23):
--   • Ventana = Leg B (único tramo real Providencia→Coquimbo): pickup 2026-07-17
--     12:00 -04, delivered 2026-07-17 21:30 -04 (llegó a Coquimbo ~21:06; el
--     15:00 original cortaba el viaje a la mitad). recogida_ventana_fin 14:00 -04.
--   • Shipper = Prueba Generador SpA (NO "Fuera de la Caja": no contaminar una
--     empresa real con carga sintética).
--   • creado_por_id = prueba-generador (dueño de Prueba Generador SpA).
--   • eco_route_polyline_encoded = ruta esperada Providencia→Coquimbo COMPUTADA
--     vía Google Routes API v2 (OAuth ADC, sin API key, ADR-038): 471.5 km.
--   • metricas_viaje.distancia_km_estimada = 471.51 → habilita cobertura_pct.
--
-- Implementado como bloque DO (PL/pgSQL) para que corra igual vía `psql -f` que
-- vía `scripts/db/agent-query.sh -f ... -y` (que ejecuta con `psql -c`, el cual
-- NO procesa meta-comandos \set). Config en la sección DECLARE.
--
-- Idempotente (UUIDs fijos + ON CONFLICT DO UPDATE — re-ejecutable sin duplicar).
-- Atómico (el bloque DO corre en una transacción implícita).
--
-- ⚠ PREREQUISITO DE VISIBILIDAD (leer antes de esperar ver algo en la UI):
--   El carrier dueño de PLFL57 (Transportes Van Oosterwyk) está hoy en
--   estado='pendiente_verificacion'. Los surfaces de carrier
--   (GET /assignments/:id y /assignments/:id/traza) exigen empresa.status='activa'
--   (requireCarrierAuth) → con la empresa sin verificar, dan 403 y la carga NO se
--   ve, aunque se haya creado. Activar la empresa es una DECISIÓN DE NEGOCIO con
--   efectos reales (la vuelve carrier verificado/elegible para matching); NO va en
--   este seed. Ver el bloque "PREREQUISITO DE VISIBILIDAD" al final (comentado).
-- =============================================================================

DO $$
DECLARE
  -- --- CONFIG (ya con las decisiones de Felipe) --------------------------------
  v_carrier   uuid := '60c344e0-b925-43a6-a7b3-aa6b07fac721';   -- Transportes Van Oosterwyk (dueña de PLFL57)
  v_shipper   uuid := '98f26fe7-77a0-4d7a-ba8d-46cce3f0d92c';   -- Prueba Generador SpA
  v_creador   uuid := 'b5f3dcab-615f-484c-8743-82becc5845d4';   -- prueba-generador (dueño Prueba Generador SpA)
  v_vehiculo  uuid := '7986d917-c221-40ea-91a4-cd59989d53c1';   -- PLFL57

  -- Ventana Leg B (timestamptz, offset Chile -04):
  v_pickup_ini timestamptz := '2026-07-17 12:00-04';  -- parado en Providencia, antes de salir (~12:54)
  v_pickup_fin timestamptz := '2026-07-17 14:00-04';  -- SUPUESTO (ventana 2h)
  v_delivered  timestamptz := '2026-07-17 21:30-04';  -- tras llegar a Coquimbo (~21:06)

  -- Ruta esperada (Google Routes API v2, Providencia→Coquimbo, 471.5 km):
  v_eco       text := $poly$xubkEjuzmL|AdA[~@Cj@sJv@q@HSLGFGTIz@KRkB`B{@h@mBz@}Ab@}]vH~DfVA^CFaf@pI}Q~CiKhBeIdCaBj@i@^aCt@o@XsA\]\OVq@dBY`AgClGqBvCWLUDQAiAqAaBiBUQ}Ay@EAWLEJB\`BrAMxAsBnPYjAq@`BKRkAjAmAx@gBzAwAdA{Aj@uBr@{B`@oCHcEYiB]cBm@wBaAmN{FaAa@qFeAqBOkDFwAJqFvAsAj@yAv@s@f@{@t@yA~AwFrFyBpBY^g@~@Mh@[t@U`A[~B[lCa@nBc@|AqHpSoFtN{B`FwCnFgFbI}Tt\aH`LeHxJeF~HuBnDkD~GcBvDoAbD_B`FaA`EeB~FkAtD{FrTgDjLkDpNqHfXiE`PqHzVcFjSkDlMeAdDaFlRgGxTqCpK[fBQvA[fDOfCCpAiAl]a@zNIpGBlMDnHKl@CdA?t@ObA_@p@o@z@k@fAq@~BUb@e@b@c@VEFqDnA}B~@SHSNkHxCiGzBqJ~CgJvCcd@tOk|@vZmAZyI`DgFhBsOjFcFfB_Cv@qLfEeYfJoQhGyThI}j@rRiMnE_DdAa@J{XxJu]~LmCr@uHlCkOtFiC|@gHpBeCbA}w@jXiGxB}W|IkQtGwL|DgFhBkMjEuDtAyMpEwE`ByE|AqIxC{HlC}LlEuUbIyAb@kJhDyHjCqO~EsEbB_G|BeVbIyBp@gFjB{FfBkFlBcHlCsL`EqGpBq@XeBj@_GvBiO|EmL`EaFnB_MbE}PbGyHjC}UhI{KvDyCfA_SvGcGxBaMbEyUbIgA`@eo@lTmDpAkBl@mDpAiQ`GaARiBj@aFnB{_@tM{Ad@mBv@{Ax@wAjAsAtA}@jAoPnVs@`AwBbDkB`DgAvAaA|@gAr@}Al@}@VoBVqMv@uUfBcCBqZzBaRpA_S|AiBXoBp@cB~@gItGa|DjeDgKxIyiCvxBsNvLub@f^qlA|bAuBdByo@he@{F~DwFfEuAbA{ArAgAhAsHdJuAvA{@p@wAv@g@RmBd@cBNeA?k@CcOiBcBQaCGyA?}CNaCX_FbA}{Cvq@kmAhX_Dp@_C\gBPiDPgE?yDMwFk@aB[_Ba@yBs@o@Ww@k@aD_BoBiAgAw@cCmB_C}BkDgEyXka@}E}GqAsBi@aAo@sAk@wAy@gCkAwEaB{G}AeFsAcD_@u@yBmD{D{EaB{BcBgDw@}Bo@}Ba@oBa@oCMcBKqCGqMI}B]oDSkAu@uCc@mAe@eAaAiB{AoBsQ}RaCgCaBkB{ImJ{EuE}M_L}q@mk@eCcCwCmDeGeIiD}EmPyT}EoG_OiSy@aA}B_C{@s@oBoA_kA}j@yDsAaA[{Cs@}{@iQcJkBwDgAuJaDiCm@sCa@_CM{@AmCJsJ~@s@DeABgCEoBM{JeA{COqFI{v@o@iE@yDPeE^{Cf@_Ez@kAZkjAte@cCtAgBnA{BlBoApAkB|BqApBoFdK_i@~cAgBxC{AtBeAlAkBdByB`BaJbGuExCsT|NcCjBqAlAyB~BwCxD}HtKoEjGuL|Oq@z@{AbCkAdC{DtJqAjDeAbCeA|Ay@dAu@l@aBdAeAb@wBd@{@FaAB{AE}Ea@aFUiABgDT_BXiDd@{AZgBl@kAr@q@f@u@v@{@hAu@pAm@~AOj@YbB]lCyB`WI`B?fAHzBHfAb@pDFfA@zAAbAMrA_@lB]rAsBnEa@lA]nA{DfRg@xCU|BObEC`CJvDx@pTt@|XjAre@RbIz@x[NnIB~DJzAhDdwAtAvh@?xDS`F{AtQoGrs@{ApQoA~M{@fKcAdNsPvpBoEfi@yGlw@_BhR}A`PaAzKc@pEo@jICxBoF`o@a@pFaBxNwAjQIrAC`A@bD@`@dCr]l@`INhCf@lF`ApMJrB?tACjAO~AUtAuAxFc@`C[~BwCrYcChRgCzR]jBi@zAo@pAaCnEg@nBKdBUjGWzDc@~H[hEw@~NmApWG~CBvCHjCJ~AnG|m@\vCjYjpCpCvWrNduAFtBC~BIhA_@|B_@xAs@bBeJjP_CdEgM|SeF`Jo@z@uP`[sa@tt@sCbFwGvLaTt_@cB~BqBvBeCvBkPxMsqAdeAaHxFeKbIcFdEm~@|t@gB~AeBhBkFzG_PzSmA`BkHdJa^be@cLfO{e@dn@cLbOsKfNgBpBaAn@o@\{Bp@mAViCV{CTaY|C_N|A_f@bFkMvAeZvDu[dD}El@eBV{LdCkH~AsCj@qGlBeGhAct@dOuATaD`@gCPoK|@cuAfKys@nFmEf@gIlAuL`BqZrEk_BjUaJrA_Dp@eKpCqDjAcEbBmX|L}YpM_EvBajArt@uZtRaBz@eBj@sAVwAHkBEiIeA}TaEwGcAq@I_Dw@w@EwGu@{AEkEQwJq@oIw@s@KmCq@yDeBy@YoDw@aAIeBAqADuBTw@NaDfAiNvF}E~BgFtCoFjDgFvDiDrC}EnDiEpCc`@rUyDtBaCjAsElBqDpAeEpAcE`AqGjAkLhBkAXcAXcFrBgGbDkAp@gLdGiGnD_FhDcClB_CnBuClBaAd@uEdB}BfA_Aj@u@n@q@r@cAvAwEtHgB~BgEdEu@n@gAv@kAp@mAl@{Ah@_I|B}ItBgNzCmCv@mEbBsPpHiQtHu|@t_@uBv@gDdA_ATqBVcCFyBQcGw@qCe@yImAgAO{gAePqc@uGeq@_KyLiB{Dc@ys@}BaMc@wBEsX{@yLSyFQiFK{Lc@aLe@yHW{FC}ABgBPuBd@mAb@k@V{B|A{DdE}PrSkJpKwG|HsHdJ_\n_@eLzMqGzHsFjGkOvQmUdXiR|T{DfEkGtHgAxA}ApCi@lAaAhCw@~CoFtY}DfTuE`WoHja@{@lDwAdEw@bByCtF_C|DmGhKy@fAeAhAaAz@aAt@{A|@_Bt@cFjBoFlBiTtHcIdCaBd@mHbCwBdAgUjIuKzD}D|AqAt@eC~Au@n@mBfBiAnAoa@~d@sEdFaIjJmM|NcLhM_FxFaDlDq@x@iAbBwB|DeAhCg@|AsAhFqXdgAqF|SwF~T[bAc@pAu@xAy@pAi@p@w@v@w@n@iAr@sAn@i@P{@TeAPsAHcDJwA@qBHeBTgCh@_PvE}\|JqFbBsAn@eAv@_A|@kAfBg@fAc@xA_A|EmAvIo@nE{Fpb@m@~D_@rBw@`CYn@kBlCs@t@}CfB_AZmB\oQrBkDh@mGr@oJjAiEr@cBf@mCpAuA`AkAnA_BdCaClE{ErJoA|BiGxLwGfMiD|GsAvBaB~Bs@|@iJxI}HhH{CzCaBlBcAbB{@xB]pAmAfGeLno@gBlJ{C~PeJlg@yBnMk@fCi@xBiAtCk@hAg@x@{CvDgDzDyNzQaCnCyDtDgBxAo\lVoIlGkKpH{FnEaDpBgCjAcHjBuJ|BmDt@_RpEaLdCcDz@sQbEiG|AuDt@eJ|BwXjGwAP{AL_BHgKAyFEcPScXQwJGoKOqKEuCH{BXcARiF|AcGdBwLrDgIjCiIbCsA\gQxFiQjFui@nPim@|QkHrBkEtAyCbAkAl@qAz@gGbGia@pa@uIpIcAhAeJbJqNtNaN`NiPhPcEdEuDdEqG|JwJfPkDrFoBfDqDbF_O`Q}KtM{BjCkA`AwAv@gA`@_BZkBNqR|@qO~@qFXwB^cAZcDvAeR`J_Bp@kA^eC\iI`A}JpAiQxBkB\eCt@wAn@aS`KuHxD_JjEuGfD{Ah@sB^uAJ}B@mGQch@}AeC@kE\k^rDcCP}B?{AIuBYkKqBuSgEcFcA_AYaBw@}MaIqKuGsBeAcBq@eB_@gD[uIg@{Je@cIa@aIc@}BUaB_@cBm@uAs@mA_AuAwAmCgDaKwMmNuQiHmJm@s@_AaAaAw@o@a@wBgAq_@yPoBy@}@Yy@QkBSkHGcHIsCCgEOiIIiABeAJmATqA^wAl@eAp@gE|CaZlS}BrAsAh@yA^yBTuK^iJRiIVcETeJL_Mj@}a@rAge@|AuBT{A`@yAn@_DjBsHfFqBbAqDhAezApc@cYrIcm@lQuAVaBLgC@wBSwZyGe|@sRcBc@utBee@oBY{BQaVe@mVq@{`@_@}FPcSv@_o@`CmPn@iQv@oOj@uA?mCK_BOyBe@o[gJiK}CeOoEkDoA_FyBoHmD{CoAq@_@iA{@w@s@k@q@k@_Aq@sAy@mCg@wBgC_M}@uEc@}Aa@kAm@sAo@cAoA{Au@m@sy@cm@y@k@mAk@cAUs@KiAEe@?sANaAVkM~E}FdCiBf@{AR_BB{AI{AWyAe@cD}AuMyGiZiOsAg@yA[}AKsHEkmA?kq@@}BNcBV}InCuGlBqP`FyDjAqPxEoFv@uCVwAHgBDiDCuDQkBQ_Fy@wA[wC{@iMuEsCw@}Bi@{Dq@kEa@}DM}DAuSRkEVeBPiCZoDz@iAZeFdBuKtE_E~AgCv@oG|AqQbEwH`B{Cd@sCVuEXuEV}Gd@mGPkCF}BJ_Gz@aAVyAj@aEzByBpAuAl@aMxDeOnEuOnEcDdAeA^_B|@g@Xo@n@_AjAo@`A]x@_@fA_ArDkJnd@s@lD_GrXm@nBe@fAiAdB_AbAgCjBaA`@gAVcCRmBE{Is@aDQiCBiBJiCZeZbGgD^aEDw[wAgBQgBYmBe@_Cw@yAm@o{BojA}X}Nit@i_@_Bs@oCy@sB[sAKo@AgBBcgBhKeFXmFVeJn@u^rBcRhAaC\}Cv@_Cz@}At@gE`CyFpDsHlEaL~G}G`EcP`KaH`EoAv@uEtDmJtIqArAkFfEcBjAq@`@oAl@_C|@yU`GiHzBmJvBaE`A}b@zKoBb@_Cn@kDt@{ATiE`@k@@kEEiQo@id@qBwK_@wDBeFf@oLhBwG|@yGlA{~@nNgdA~O}Cr@}DxAcB|@eJjFcBhAiMvHqAl@kA\u@LqCVgKj@iF`@wMp@uk@lD_Oz@qB@}BCeCS_dA_P}uAuTuBYqBQ}AGcBCqoCjAq[PsNDsWJ_E?cZLqIBgOJaBJgARaBf@w@Z{@f@wAbA{LrJmNxK{KtI}FrE}EjD}EfDmE|CuBnAeA`@{AXcBJ{@?}GWiB?kBTsFxAuD|@_NpC}f@xJaSxDwCp@}dCnf@ceAxSsEz@iE`AgNhC{KxBsiBr^eHpAocAfS_T~Dyb@zIgOrCoPdD}JlBag@|Js}AtZ{C^cCN}B@qCKiFg@yFk@yHq@eFk@_B[eBo@w@c@yAeAcAgAo@_A_I}MaAkAqAsAmEcD{EiD{BsAkBu@wA]iBOq@?_ADoBTmDt@oYjHmZzHyh@zMkDdAyHjCoG~B}HhDiT~IeJpD}YxLgA`@}BbAaObGgSlIqBl@cEx@kJrAsA^eBv@eBpAkHfHkGrG_EpEwArAu@f@kAl@oA^qATmVnCiEd@qCf@{C`AeFdB_MnEcBf@oARiADmAAyBSoMcBoCQmDC{IBu@AgBM}F_A}Dq@aD]aAGqBBiO`AcF`@}Ih@{Jn@o[ZcPJ_JFwFJyYR_BJi_@dDqb@hEyZxCma@|Dg]hDuO|AeIp@iBBwBIwAWyEmAwKeDmAWqBQcZqA}YgA{ECeEJat@nCuc@dB_Pj@}A?kBEqBOyUwD_iAqQwYyEsR{C}BUgCIeJA_KN}BEwBOqAOea@_GqAWmBk@mAc@mf@yTeBi@mBYoAIiO@gBHsAPq@Nq@RaAf@yAbA}@|@m@r@c@t@q@zAOd@Sz@O~@K`AI`Aa@rLAfABxBJdAXrB|AbHL|@H|@F|BAfAOnC[rBUx@Un@_@|@mAnBcAfAqAbAg@VgCdAmHfCcCfA_ClAaAb@sBv@aNfE{Bj@kCb@uANoJd@kJd@_Sr@uNr@wJZgPv@yFXcCV{@RgBl@yAz@o@d@g@f@g@l@aA~Am@tAMd@U|@QdAYxCWpDYvB[zAq@dBa@t@gAvAoAhAk@^iAn@wAh@gAXoAf@wHtBcGlB{@PaAH_BB_ACwB_@sAe@{Aw@aUaO_F_DiCoA_A]{@UuBa@iAKyAEuBDyAL_ANwBd@oPlFuA`@cBZaBJ{BAaAIqFcA{oA_WuH_BcJeBoPgDeDg@gBMsAC{A?uBL_AHuFdAm]lHeOdDwB\yCVwBBsAA}BMwFa@yRkAsDc@mD{@}FkBwA]uBWa@Eq@?u@@sBPmDb@eADiA?iAIaBYoAa@yAq@{PuJoI}E_CwAaBoAa@_@_AoAi@{@i@qAiAeDy@oB}@}Ai@o@gAeA}AcA{D_BaMuEsBk@oASuBM_C@}C\yA^oBx@wIlEsEfCkOzH{F~CmFnCgBv@sE|A}IxCwCfA_LnDe_@lMgCn@mCd@}APkn@tD_e@bCcn@lD}Mt@kLp@yBXeCh@sBr@uHlDaK~DkM`GoDvAiA\mB`@iBPwBDqBEqBW{A[gV_HoMmDsh@cOuSaGoHoByF_BmIeCqAUaAKoCAq@Bi@FwAX_I`CqDdAwGhByk@xPyMvDwDhA}D`AuEpAiANq@F_A@wAGiC[iCe@qAIuA?iBLoB^}XzHcA^uAp@sA~@k@d@kApAm@z@qN`WaArBq@nBi@pBg@rCWdCIvBCnA@jCLzChBlTHbCCfCE|@K~@e@hC]lA_AlBs@fA_BjB{@r@oAt@kAf@kAZkBXoBF}AAkBUuA_@iA_@a@UyAe@eBWm@E}@AmAFeCVkCd@u@CcGpAsDt@_Bf@gAj@uAdAeAjAcA|Ao@|Ak@vBaBlIi@fCk@bBWf@k@~@y@~@mB|AoAv@g@T_B`@sFz@eLfBuBXgEp@mEl@cCd@mEn@ie@hHoBTwJhBoBTkBJkCCsCS_VkCDk@{@a@aAm@o@Sy@KzA}C^m@ZUf@Qb@APBVJXAl@SPDj@z@TGZk@LERBd@JRAHCb@i@FOFc@j@cAd@c@RQBKGa@[]Os@A]@SJYLQPO\KX?b@NhBbAjBvApAz@lAp@pA~@JBFGFU@g@EqAOuAGsAMq@W}@AWHaAAe@K[OWKq@AWDOJKf@C|@Fh@@`AMt@DFLDd@FDH@^WH?j@Ld@?hAb@XBRCl@YNCr@?HGFo@Ge@I[Oa@]a@kA_AKU?UL]C]KWMm@S[YUSIk@i@QU]cAi@wB]oB]w@c@qBIqA?a@I{@Uy@DOZCHMA_@S_AUo@?YH@CKL{@LoBA{@Cc@HwFE[q@wAyBuCW[GMES?UJm@@uDL_DFqFFmA?uAE{ABoAC{@MqAg@cKi@cDMuC@w@DYLeC?g@DOT]Hc@Da@Cg@Y_Cc@cCsAoDW{@k@sAeEkIIYIu@]cAc@s@k@s@oB_B]U[[q@mAa@i@I]YyAY_Ak@i@a@[oAsAcAaAwCiCgCiCmHiHmBsBu@o@s@y@m@}@u@gBs@aA}@s@Ka@Mk@Sq@Ge@?UQi@QiAO_@yB}D[c@]c@m@_AUMy@QsBaA[EWFiFpBk@\s@^yAZyC~@a@N}@t@Y?s@Ga@FcDdAu@Hg@N{DfBYNyCp@cA^u@Nk@RQJYHoBHeD^eAE_Eg@w@Sk@Wo@GsA?mMa@cKo@_Dc@iBPo@Qy@Yw@OaCq@iEuAyCw@qAa@uJ{E}BuAcDuAkA_@gASmEg@{CSsA]oAw@k@_@q@s@i@_Aa@aBYYG_@@w@Z_AFSDu@b@qALu@nAoDZgAJa@Ho@Pk@^m@d@qBNYdAqAJWBQU_C@sAKe@Oe@gAgBc@k@iAu@k@aAq@w@aBwAm@e@cGwD}A{@wHeFoBwAoIsFsDgCKUU{@EIe@a@UKeAI{@Go@Qi@Y_ByA_As@eEaCoAe@aHwAYEyAk@eFe@{AAW@o@I[QcBkA[e@MOqAy@uEuEWGg@@cAGk@Km@Y{@y@IMIWAsD@_AEc@w@qBIk@Ey@O{@q@eA[SgBe@w@Y}C}@a@_@i@wAyAuCQYYy@[{Ag@wA{@}Da@mAmDeE[Wy@c@s@Ga@SOUWaAS_Bw@sAeAaBc@]Ya@EQEc@IKcA[K?{@Wa@SgDoCGS@YPg@v@w@DQESe@g@]c@SEYD]^UDo@GWKk@e@e@QiAm@QMGUAIJw@Qw@O[SO{Bw@QQ_@c@_@Y_Ai@Ya@MWSOmBk@}@Jc@Tu@X_@Hi@?IGMSg@cAc@]aAYSQQQUw@W{AK]Ya@YWk@[gBw@[g@YaAYg@_@_@c@M[@a@Li@\mBlBeAl@{Af@_@X}Ap@[Da@@YCkBs@kCoBwEgEaAs@[S}@c@mBu@{HgCmIgBiAKwBBqMpB{@Fm@Pi@h@Wf@gGjNaArBQTa@PaAF_IIy@Bu@RcC~@cLpFeBr@}Al@eAj@]Lk@JkEZqBR_AAiCIi[BoLF{MTa@F_A^k@^_@`@y@bBg@|@a@j@QNwCdAkBpA{A~AqAxB_AnAg@\mAh@mDrB]Ha@AaDUq@B{@NkAEw@G{@@c@Jq@b@o@XgAPgAZeAn@e@RqE|CsCxB_DhBk@NgBXuKfAsBLuFn@oGh@mGz@iBXqEfAeBZy@HmCDeSi@wEQuDFuDCoC@iBOaBB{@Hu@R}@ZyAt@o@V[FU?mA[y@Gu@L]XmAtASh@UbA[rBg@bA_AdAe@V[JmDJiAH{@LuAEe@Ma@[m@o@aAy@[Mc@Gw@B_@D}@\_@ZOX[|@Wd@YXYPiAh@wBnAuCjCoAvAgAn@e@R_@Jm@H[@aCv@aEjBsAp@m@TmDt@eAVeBv@m@b@u@`AS^Ud@e@ZeA`A[h@g\eTcxCunBmAaAiBiBaHuHgB}AwEeD}hFwoDiAcA}@gAaAeBkKsVmDmIwAkCcAwAeAoAmBkBgRgPgBkBcAuAqAsBkAyB{`@qz@[k@qJgSiAcCq@kA{AqBkAgA}AeAiB}@cScHqG}BsBq@aB]kAKiA?uBJqAXe@NoAh@mAt@eAbA}ApB}CvFyIxPmFfKsUvc@_BdDeGhNyAlDqSfd@kIbRgDfHoArBy@dAy]vg@w@dA}@`AeA|@oAr@wAh@}AXy@L{JfA{Cb@wIvBqVnFsCd@gFh@[FgJdAgBF}EEkFLuBNiBIaBWqGgBsBY}BMqMOwBKeAQ{Ac@m@UsAw@mAaA_FuEyX_X_HoGcBaBgR_Q{]g\sBcBoA{@gBcAmEiBq]{J{DmAwB{@qAs@}CoBgC{Byf@oj@kBqBk@i@u@i@mC}AcCy@}A]oD]uEYqkBkJqOy@sYwAuVqA_{BcLalC}M}p@gD}Ia@cEe@oCe@k|@aRq^wHeBUuBIoBByBNqTtC{BLgB?{BOwAQcCi@{By@yPgHed@}QmCy@qCm@yCa@gCQaPUkJIcFMaEY}Di@}p@wMkr@gNoz@uPuDaAyDuAgpBqv@_NoFgKsDuO_F}w@aVk~Bur@e`@mLwE{AiJqC_N}Ds}@iXyAY_BOiBCuABcL`AkPnBkLpA{BLyB@qCIiCYsB[}wAcZm\_H{Cm@wCy@oCaAqi@mTcHkCu_@mOqPuGyi@qTam@_VqQkH{QmHiRwHmI_D}GuCaw@}ZcrAwh@kIcDuL_FcCy@mA]wA[qB]mC[mlBcO{Jy@uvHam@miB{NmEm@kCi@gT}Fub@mLkAe@}Cw@ke@gM_x@qTcD{@qo@kQuh@uNmDeAeJ}B}Ey@oD[muFiYsLm@co@eDwoB_KaIe@oGWgB?}BRkBZgBf@uBx@sNdGuKlE}Bl@m@H{DFsAIcBYo_@}HsWsFmB[cBKuACmBHkBRiCl@cBp@sAt@wA`A{MzKuIlHiN`Lof@~`@sTvQqLrJoBnBsC~BoBrAiBbAsAn@{CfAaXrHyAX}@HmA@oAEoBYgA_@m@UgS}Kk]qRqAm@sA_@gBY}AIyA@yHf@seBpLwAFaBCsAOoAYq@U}Ay@yJmGsA_A{AkAyA}AcA{AcBmDcc@odAmL{Xy@gBe@s@kAcBqBsBgCiBcHyEaBqAeCkCcBuBqCeCeGwGoI{JmC}CgFoGoD_EuJcLeBsBS@_@T`@\v@x@Nj@VZdAfAvDhEhFnGzCdDrFzG$poly$;
  v_dist_est  numeric := 471.51;   -- distancia estimada km (Routes API) → cobertura_pct

  v_precio    int  := 850000;      -- placeholder CLP

  -- IDs fijos de las filas sintéticas (idempotencia):
  v_trip      uuid := 'a1b2c3d4-0000-4000-8000-000000000001';
  v_offer     uuid := 'a1b2c3d4-0000-4000-8000-000000000002';
  v_asig      uuid := 'a1b2c3d4-0000-4000-8000-000000000003';
  v_token     uuid := 'a1b2c3d4-0000-4000-8000-000000000004';
  v_codigo    text := 'SYN-PLFL5701';   -- marca sintética (≤12 chars, UNIQUE)
BEGIN
  -- 1) VIAJE (estado terminal 'entregado'; tipo_carga 'agricola' = cereales)
  INSERT INTO viajes (
    id, codigo_seguimiento, generador_carga_empresa_id, creado_por_id,
    origen_direccion_raw, origen_codigo_region,
    destino_direccion_raw, destino_codigo_region,
    tipo_carga, carga_peso_kg, carga_descripcion,
    recogida_fecha_raw, recogida_ventana_inicio, recogida_ventana_fin,
    precio_propuesto_clp, estado
  ) VALUES (
    v_trip, v_codigo, v_shipper, v_creador,
    'Chile España 1331, Providencia, Región Metropolitana', '13',
    'Dario Salas 1111, Coquimbo, Región de Coquimbo', '04',
    'agricola', 10000,
    'Maxi sacos de cereales, 10.000 kg — [SINTETICO: carga de prueba para desbloquear historial por carga #615, PLFL57]',
    'Providencia -> Coquimbo (17/07/2026, hora Chile) — ventana Leg B (recon telemetria)',
    v_pickup_ini, v_pickup_fin, v_precio, 'entregado'
  )
  ON CONFLICT (id) DO UPDATE SET
    generador_carga_empresa_id = EXCLUDED.generador_carga_empresa_id,
    creado_por_id              = EXCLUDED.creado_por_id,
    recogida_ventana_inicio    = EXCLUDED.recogida_ventana_inicio,
    recogida_ventana_fin       = EXCLUDED.recogida_ventana_fin,
    estado                     = EXCLUDED.estado,
    actualizado_en             = now();

  -- 2) OFERTA (requerida: asignaciones.oferta_id es NOT NULL; estado 'aceptada')
  INSERT INTO ofertas (
    id, viaje_id, empresa_id, vehiculo_sugerido_id,
    puntaje, estado, precio_propuesto_clp, expira_en
  ) VALUES (
    v_offer, v_trip, v_carrier, v_vehiculo,
    1000, 'aceptada', v_precio, v_pickup_ini
  )
  ON CONFLICT (id) DO UPDATE SET
    empresa_id           = EXCLUDED.empresa_id,
    estado               = EXCLUDED.estado,
    precio_propuesto_clp = EXCLUDED.precio_propuesto_clp,
    expira_en            = EXCLUDED.expira_en,
    actualizado_en       = now();

  -- 3) ASIGNACIÓN (estado 'entregado' + entregado_en seteado → carga entregada)
  INSERT INTO asignaciones (
    id, viaje_id, oferta_id, empresa_id, vehiculo_id,
    estado, precio_acordado_clp,
    aceptado_en, recogido_en, entregado_en,
    tracking_token_publico, eco_route_polyline_encoded
  ) VALUES (
    v_asig, v_trip, v_offer, v_carrier, v_vehiculo,
    'entregado', v_precio,
    v_pickup_ini, v_pickup_ini, v_delivered,
    v_token, v_eco
  )
  ON CONFLICT (id) DO UPDATE SET
    empresa_id                 = EXCLUDED.empresa_id,
    vehiculo_id                = EXCLUDED.vehiculo_id,
    estado                     = EXCLUDED.estado,
    recogido_en                = EXCLUDED.recogido_en,
    entregado_en               = EXCLUDED.entregado_en,
    eco_route_polyline_encoded = EXCLUDED.eco_route_polyline_encoded,
    actualizado_en             = now();

  -- 4) MÉTRICAS DEL VIAJE (distancia estimada → habilita cobertura_pct en la vista)
  INSERT INTO metricas_viaje (viaje_id, distancia_km_estimada)
  VALUES (v_trip, v_dist_est)
  ON CONFLICT (viaje_id) DO UPDATE SET distancia_km_estimada = EXCLUDED.distancia_km_estimada;

  RAISE NOTICE 'Carga sintetica % lista (viaje %, oferta %, asignacion %)', v_codigo, v_trip, v_offer, v_asig;
END $$;

-- Verificación (read-only). Corré esto después para confirmar:
SELECT v.codigo_seguimiento, v.estado AS viaje, o.estado AS oferta, a.estado AS asignacion,
       a.entregado_en, (a.eco_route_polyline_encoded IS NOT NULL) AS tiene_ruta_esperada,
       m.distancia_km_estimada
FROM viajes v
JOIN ofertas o        ON o.viaje_id = v.id
JOIN asignaciones a   ON a.viaje_id = v.id
LEFT JOIN metricas_viaje m ON m.viaje_id = v.id
WHERE v.id = 'a1b2c3d4-0000-4000-8000-000000000001';

-- =============================================================================
-- ROLLBACK / UNDO (deshacer esta carga sintética) — ejecutá esto para revertir:
-- =============================================================================
-- BEGIN;
-- DELETE FROM metricas_viaje WHERE viaje_id = 'a1b2c3d4-0000-4000-8000-000000000001';
-- DELETE FROM asignaciones   WHERE id = 'a1b2c3d4-0000-4000-8000-000000000003';
-- DELETE FROM ofertas        WHERE id = 'a1b2c3d4-0000-4000-8000-000000000002';
-- DELETE FROM viajes         WHERE id = 'a1b2c3d4-0000-4000-8000-000000000001';
-- COMMIT;
-- (orden FK-safe: metricas → asignación → oferta → viaje.)

-- =============================================================================
-- PREREQUISITO DE VISIBILIDAD (OPCIONAL — DECISIÓN DE NEGOCIO, NO parte del seed)
-- =============================================================================
-- Van Oosterwyk (carrier) está 'pendiente_verificacion' → los surfaces de carrier
-- dan 403 (requireCarrierAuth exige 'activa'). Para PODER ver la carga en la UI
-- hay que activar la empresa. Esto la vuelve carrier verificado/elegible para
-- matching (efecto real). Descomentá solo si aceptás ese efecto:
-- BEGIN;
-- UPDATE empresas SET estado='activa', actualizado_en=now()
--   WHERE id='60c344e0-b925-43a6-a7b3-aa6b07fac721' AND estado='pendiente_verificacion';
-- COMMIT;
-- Revertir:
-- UPDATE empresas SET estado='pendiente_verificacion' WHERE id='60c344e0-b925-43a6-a7b3-aa6b07fac721';
