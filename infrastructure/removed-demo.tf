# T10-03 (#745) — recursos de la demo que siguen en el state y NO se destruyen.
#
# El apply de #745 nunca corrió. Sin esto, Terraform destruye lo que salió de
# la config. La revisión viva del api monta 5 de los secretos
# (DEMO_SEED_PASSWORD y los 4 DEMO_ACCOUNT_PASSWORD_*_2026). Borrarlos deja
# esa revisión sin los mounts. `destroy = false` los olvida y los deja en
# Secret Manager.
#
# Terraform 1.16 no acepta una clave de instancia en `removed.from` (tiene que
# ser la dirección del recurso, y estos recursos siguen declarados para los
# secretos que no son demo). Cada instancia se mueve primero a una dirección
# que no existe en la config y esa dirección se olvida en el mismo apply.
# Patrón que HashiCorp reconoce como válido mientras `removed` no soporte
# instancias: move y luego remove, encadenados.
#
# No entran acá (sí se destruyen): las 3 métricas sec001 (demo_ttl_low,
# demo_uid_retired, auth_is_demo_blocked), las 2 alertas (demo_ttl_low,
# auth_is_demo_blocked_anomaly) y el scheduler demo-account-ttl-alert.
#
# Tras el apply que los olvide, este archivo se puede borrar.

# --- 9 secretos ---

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-shipper"]
  to   = google_secret_manager_secret.retired_demo_account_password_shipper
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_shipper

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-carrier"]
  to   = google_secret_manager_secret.retired_demo_account_password_carrier
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_carrier

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-stakeholder"]
  to   = google_secret_manager_secret.retired_demo_account_password_stakeholder
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_stakeholder

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-conductor"]
  to   = google_secret_manager_secret.retired_demo_account_password_conductor
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_conductor

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-seed-password"]
  to   = google_secret_manager_secret.retired_demo_seed_password
}

removed {
  from = google_secret_manager_secret.retired_demo_seed_password

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-shipper-2026"]
  to   = google_secret_manager_secret.retired_demo_account_password_shipper_2026
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_shipper_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-carrier-2026"]
  to   = google_secret_manager_secret.retired_demo_account_password_carrier_2026
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_carrier_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-stakeholder-2026"]
  to   = google_secret_manager_secret.retired_demo_account_password_stakeholder_2026
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_stakeholder_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-conductor-2026-firebase"]
  to   = google_secret_manager_secret.retired_demo_account_password_conductor_2026_firebase
}

removed {
  from = google_secret_manager_secret.retired_demo_account_password_conductor_2026_firebase

  lifecycle {
    destroy = false
  }
}

# --- 5 versiones (solo placeholder=true; los *-2026 no tenían version de Terraform) ---

moved {
  from = google_secret_manager_secret_version.hotfix_2026_05_14_placeholder["demo-account-password-shipper"]
  to   = google_secret_manager_secret_version.retired_demo_account_password_shipper
}

removed {
  from = google_secret_manager_secret_version.retired_demo_account_password_shipper

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_version.hotfix_2026_05_14_placeholder["demo-account-password-carrier"]
  to   = google_secret_manager_secret_version.retired_demo_account_password_carrier
}

removed {
  from = google_secret_manager_secret_version.retired_demo_account_password_carrier

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_version.hotfix_2026_05_14_placeholder["demo-account-password-stakeholder"]
  to   = google_secret_manager_secret_version.retired_demo_account_password_stakeholder
}

removed {
  from = google_secret_manager_secret_version.retired_demo_account_password_stakeholder

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_version.hotfix_2026_05_14_placeholder["demo-account-password-conductor"]
  to   = google_secret_manager_secret_version.retired_demo_account_password_conductor
}

removed {
  from = google_secret_manager_secret_version.retired_demo_account_password_conductor

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_version.hotfix_2026_05_14_placeholder["demo-seed-password"]
  to   = google_secret_manager_secret_version.retired_demo_seed_password
}

removed {
  from = google_secret_manager_secret_version.retired_demo_seed_password

  lifecycle {
    destroy = false
  }
}

# --- 9 IAM secretAccessor del SA runtime (api_accessor) ---

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-shipper"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_shipper
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_shipper

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-carrier"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_carrier
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_carrier

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-stakeholder"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_stakeholder
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_stakeholder

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-conductor"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_conductor
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_conductor

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-seed-password"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_seed_password
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_seed_password

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-shipper-2026"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_shipper_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_shipper_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-carrier-2026"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_carrier_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_carrier_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-stakeholder-2026"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_stakeholder_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_stakeholder_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor["demo-account-password-conductor-2026-firebase"]
  to   = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_conductor_2026_firebase
}

removed {
  from = google_secret_manager_secret_iam_member.retired_api_accessor_demo_account_password_conductor_2026_firebase

  lifecycle {
    destroy = false
  }
}

# --- 9 IAM secretmanager.admin de dev@boosterchile.com (felipe_admin) ---

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-shipper"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_shipper
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_shipper

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-carrier"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_carrier
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_carrier

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-stakeholder"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_stakeholder
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_stakeholder

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-conductor"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_conductor
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_conductor

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-seed-password"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_seed_password
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_seed_password

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-shipper-2026"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_shipper_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_shipper_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-carrier-2026"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_carrier_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_carrier_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-stakeholder-2026"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_stakeholder_2026
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_stakeholder_2026

  lifecycle {
    destroy = false
  }
}

moved {
  from = google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin["demo-account-password-conductor-2026-firebase"]
  to   = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_conductor_2026_firebase
}

removed {
  from = google_secret_manager_secret_iam_member.retired_felipe_admin_demo_account_password_conductor_2026_firebase

  lifecycle {
    destroy = false
  }
}

# --- 1 IAM secretmanager.viewer de github-deployer sobre demo-seed-password ---
# Recurso único (sin for_each): `removed.from` puede ser la dirección directa.

removed {
  from = google_secret_manager_secret_iam_member.demo_seed_password_github_deployer_viewer

  lifecycle {
    destroy = false
  }
}
