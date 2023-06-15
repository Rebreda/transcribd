/* exported displayDateTime formatTime */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Meg Ford <megford@gnome.org>
 *
 */
import Gettext from 'gettext';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';

export function formatTime(nanoSeconds: number): string {
    const time = new Date(0, 0, 0, 0, 0, 0, nanoSeconds / Gst.MSECOND);

    const miliseconds = (time.getMilliseconds() / 100).toString();
    const seconds = time.getSeconds().toString().padStart(2, '0');
    const minutes = time.getMinutes().toString().padStart(2, '0');
    const hours = time.getHours().toString().padStart(2, '0');

    // eslint-disable-next-line no-irregular-whitespace
    return `${hours} ∶ ${minutes} ∶ ${seconds} . <small>${miliseconds}</small>`;
}

export function displayDateTime(time: GLib.DateTime): string {
    const DAY = 86400000000;
    const now = GLib.DateTime.new_now_local();
    const difference = now.difference(time);

    const days = Math.floor(difference / DAY);
    const weeks = Math.floor(difference / (7 * DAY));
    const months = Math.floor(difference / (30 * DAY));
    const years = Math.floor(difference / (365 * DAY));

    if (difference < DAY) {
        const formattedTime = time.format('%X');
        // The fallback here should never be seen, but we want it here
        // for type safety purposes
        return formattedTime ? formattedTime : _('Less than a day ago');
    } else if (difference < 2 * DAY) {
        return _('Yesterday');
    } else if (difference < 7 * DAY) {
        ``;
        return Gettext.ngettext('%d day ago', '%d days ago', days).format(days);
    } else if (difference < 14 * DAY) {
        return _('Last week');
    } else if (difference < 28 * DAY) {
        return Gettext.ngettext('%d week ago', '%d weeks ago', weeks).format(
            weeks
        );
    } else if (difference < 60 * DAY) {
        return _('Last month');
    } else if (difference < 360 * DAY) {
        return Gettext.ngettext('%d month ago', '%d months ago', months).format(
            months
        );
    } else if (difference < 730 * DAY) {
        return _('Last year');
    }

    return Gettext.ngettext('%d year ago', '%d years ago', years).format(years);
}
