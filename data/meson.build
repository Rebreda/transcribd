icon_dir = 'icons' / 'hicolor' / 'scalable' / 'apps'
install_data(
  'icons' / '@0@.svg'.format(application_id),
  install_dir:  sound_recorder_datadir / icon_dir
)

icon_dir = 'icons' / 'hicolor' / 'symbolic' / 'apps'
install_data(
  'icons' / 'org.gnome.SoundRecorder-symbolic.svg',
  rename: '@0@-symbolic.svg'.format(application_id),
  install_dir: sound_recorder_datadir / icon_dir
)

desktop_conf = configuration_data()
desktop_conf.set('app-id', application_id)
desktop_file = i18n.merge_file(
  input: configure_file(
  	input: 'org.gnome.SoundRecorder.desktop.in.in',
  	output: '@BASENAME@',
  	configuration: desktop_conf
  ),
  output: '@0@.desktop'.format(application_id),
  install: true,
  install_dir: sound_recorder_datadir / 'applications',
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
configure_file(
  input: 'org.gnome.SoundRecorder.gschema.xml.in',
  output: '@0@.gschema.xml'.format(application_id),
  configuration: gsettings_conf,
  install: true,
  install_dir: sound_recorder_schemadir
)

data_res = gnome.compile_resources(
  application_id + '.data',
  'org.gnome.SoundRecorder.data.gresource.xml',
  gresource_bundle: true,
  install_dir: sound_recorder_pkgdatadir,
  install: true
)

metainfo_conf = configuration_data()
metainfo_conf.set('app-id', application_id)
metainfo_conf.set('gettext-package', gettext_package)

metainfo_file = i18n.merge_file(
  input: configure_file(
  	input: 'org.gnome.SoundRecorder.metainfo.xml.in.in',
  	output: '@BASENAME@',
  	configuration: metainfo_conf
	),
  output: '@0@.metainfo.xml'.format(application_id),
  po_dir: po_dir,
  install: true,
  install_dir:  sound_recorder_datadir / 'metainfo'
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
