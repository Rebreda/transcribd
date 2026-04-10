icon_dir = 'icons' / 'hicolor' / 'scalable' / 'apps'
install_data(
  'icons' / 'app.rebreda.Transcribd.svg',
  install_dir:  transcribd_datadir / icon_dir
)

icon_dir = 'icons' / 'hicolor' / 'symbolic' / 'apps'
install_data(
  'icons' / 'app.rebreda.Transcribd-symbolic.svg',
  rename: '@0@-symbolic.svg'.format(application_id),
  install_dir: transcribd_datadir / icon_dir
)

desktop_conf = configuration_data()
desktop_conf.set('app-id', application_id)
desktop_file = i18n.merge_file(
  input: configure_file(
	input: 'app.rebreda.Transcribd.desktop.in.in',
  	output: '@BASENAME@',
  	configuration: desktop_conf
  ),
  output: '@0@.desktop'.format(application_id),
  install: true,
  install_dir: transcribd_datadir / 'applications',
  po_dir: po_dir,
  type: 'desktop'
)
desktop_file_validate = find_program('desktop-file-validate', required: false)
if desktop_file_validate.found()
  test(
    'validate-desktop',
    desktop_file_validate,
    args: [
      desktop_file.full_path()
    ]
  )
endif

gsettings_conf = configuration_data()
gsettings_conf.set('app-id', application_id)
gsettings_conf.set('gettext-package', gettext_package)
schema_file = configure_file(
  input: 'app.rebreda.Transcribd.gschema.xml.in',
  output: '@0@.gschema.xml'.format(application_id),
  configuration: gsettings_conf,
  install: true,
  install_dir: transcribd_schemadir
)

glib_compile_schemas = find_program('glib-compile-schemas')
schema_compile = custom_target(
  'compile-schemas',
  input: schema_file,
  output: 'gschemas.compiled',
  command: [
    glib_compile_schemas,
    '--strict',
    '--targetdir', meson.current_build_dir(),
    meson.current_build_dir(),
  ],
  build_by_default: true,
)

data_res = gnome.compile_resources(
  application_id + '.data',
  'app.rebreda.Transcribd.data.gresource.xml',
  gresource_bundle: true,
  install_dir: transcribd_pkgdatadir,
  install: true
)

metainfo_conf = configuration_data()
metainfo_conf.set('app-id', application_id)
metainfo_conf.set('gettext-package', gettext_package)

metainfo_file = i18n.merge_file(
  input: configure_file(
  input: 'app.rebreda.Transcribd.metainfo.xml.in.in',
  	output: '@BASENAME@',
  	configuration: metainfo_conf
	),
  output: '@0@.metainfo.xml'.format(application_id),
  po_dir: po_dir,
  install: true,
  install_dir:  transcribd_datadir / 'metainfo'
)

appstream_util = find_program('appstream-util', required: false)
if appstream_util.found()
  test(
    'validate-metainfo', appstream_util,
    args: [
      'validate-relax', '--nonet', metainfo_file.full_path()
    ]
  )
endif
