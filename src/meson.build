app_conf = configuration_data()
app_conf.set('profile', profile)
app_conf.set('prefix', sound_recorder_prefix)
app_conf.set('libdir', sound_recorder_libdir)
app_conf.set('PACKAGE_VERSION', meson.project_version())
app_conf.set('GJS', gjs_console)
app_conf.set('APPLICATION_ID', application_id)

app = configure_file(
  input: 'org.gnome.SoundRecorder.in',
  output: application_id,
  install: true,
  install_dir: sound_recorder_pkgdatadir,
  configuration: app_conf
)

sources = files(
  'application.ts',
  'main.ts',
  'recorder.ts',
  'recorderWidget.ts',
  'recording.ts',
  'recordingList.ts',
  'recordingListWidget.ts',
  'row.ts',
  'utils.ts',
  'waveform.ts',
  'window.ts',
)

tsc_out = meson.project_build_root() / 'tsc-out'

typescript = custom_target(
  'typescript-compile',
  input: sources,
  build_by_default: true,
  build_always_stale: true,
  command: [ tsc, '--outDir', tsc_out ],
  output: ['tsc-output'],
)

source_res_conf = configuration_data()
source_res_conf.set('profile', profile)
src_res = gnome.compile_resources(
  application_id + '.src',
  configure_file(
  	input: 'org.gnome.SoundRecorder.src.gresource.xml.in',
  	output: '@BASENAME@',
  	configuration: source_res_conf
  ),
  dependencies: typescript,
  source_dir: tsc_out,
  gresource_bundle: true,
  install: true,
  install_dir: sound_recorder_pkgdatadir
)

run_target('run',
  command: app,
  depends: [
    data_res,
    src_res,
  ]
)
