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
