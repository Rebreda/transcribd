app_conf = configuration_data()
app_conf.set('profile', profile)
app_conf.set('prefix', transcribd_prefix)
app_conf.set('libdir', transcribd_libdir)
app_conf.set('PACKAGE_VERSION', meson.project_version() + version_suffix)
app_conf.set('GJS', gjs_console)
app_conf.set('APPLICATION_ID', application_id)

app = configure_file(
  input: 'io.github.rebreda.Transcribd.in',
  output: application_id,
  install: true,
  install_dir: transcribd_pkgdatadir,
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
  'searchIndex.ts',
  'utils.ts',
  'waveform.ts',
  'window.ts',
  'transcriber.ts',
  'openaiClient.ts',
  'transcriptionParsing.ts',
  'detailView.ts',
  'preferences.ts',
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
  input: 'io.github.rebreda.Transcribd.src.gresource.xml.in',
  	output: '@BASENAME@',
  	configuration: source_res_conf
  ),
  dependencies: typescript,
  source_dir: tsc_out,
  gresource_bundle: true,
  install: true,
  install_dir: transcribd_pkgdatadir
)

run_schema_dir = meson.project_build_root() / 'data'
env_prog = find_program('env')

run_target('run',
  command: [env_prog, 'GSETTINGS_SCHEMA_DIR=@0@'.format(run_schema_dir), app],
  depends: [
    schema_compile,
    data_res,
    src_res,
  ]
)
